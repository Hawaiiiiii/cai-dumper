import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { ExportIndexEntry, ExportIndexRecord, Settings, CharacterSummary, SessionSnapshot, Freshness, ViewerProfile, ChatIndexEntry, CharacterIndexEntry, PersonaSummary, VoiceSummary } from '../types';

interface LoadResult<T> {
  data: T;
  changed: boolean;
}

const DEFAULT_SETTINGS = (): Settings => ({
  exportRootPath: path.join(app.getPath('documents'), 'CAI_Exports'),
  lastAccountProfileUrl: null,
  ui: { theme: 'dark', accent: 'amber', wallpaper: null },
  verboseLogs: false,
  lastScan: null,
  userProfile: null,
});

export class StorageService {
  private baseDir: string;
  private storageDir: string;
  private indexPath: string;
  private settingsPath: string;
  private profileDir: string;
  private characterCachePath: string;
  private sessionPath: string;
  private viewerPath: string;
  private chatsIndexPath: string;
  private charactersIndexPath: string;
  private personasIndexPath: string;
  private voicesIndexPath: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.storageDir = path.join(baseDir, 'storage');
    this.indexPath = path.join(this.storageDir, 'exports-index.json');
    this.settingsPath = path.join(this.storageDir, 'settings.json');
    this.profileDir = process.env.CAI_DUMPER_PROFILE_DIR || path.join(baseDir, 'pw-profile');
    this.characterCachePath = path.join(this.storageDir, 'character-cache.json');
    this.sessionPath = path.join(this.storageDir, 'session.json');
    this.viewerPath = path.join(this.storageDir, 'viewer.json');
    this.chatsIndexPath = path.join(this.storageDir, 'chats-index.json');
    this.charactersIndexPath = path.join(this.storageDir, 'characters-index.json');
    this.personasIndexPath = path.join(this.storageDir, 'personas-index.json');
    this.voicesIndexPath = path.join(this.storageDir, 'voices-index.json');
    this.ensureDirs();
  }

  getProfileDir() {
    this.ensureDirs();
    return this.profileDir;
  }

  resetProfileDir() {
    if (fs.existsSync(this.profileDir)) {
      fs.rmSync(this.profileDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.profileDir, { recursive: true });
    return this.profileDir;
  }

  getSettings(): Settings {
    const { data, changed } = this.readJson<Settings>(this.settingsPath, DEFAULT_SETTINGS());
    if (changed) this.writeJson(this.settingsPath, data);
    return data;
  }

  saveSettings(partial: Partial<Settings>): Settings {
    const current = this.getSettings();
    const merged: Settings = {
      ...DEFAULT_SETTINGS(),
      ...current,
      ...partial,
      ui: { ...DEFAULT_SETTINGS().ui, ...(current.ui || {}), ...(partial.ui || {}) },
    };
    this.writeJson(this.settingsPath, merged);
    return merged;
  }

  saveUserProfile(profile: ViewerProfile | null): Settings {
    const current = this.getSettings();
    const updated: Settings = { ...current, userProfile: profile };
    this.writeJson(this.settingsPath, updated);
    return updated;
  }

  // Viewer persistence
  getViewer(): ViewerProfile | null {
    const { data } = this.readJson<ViewerProfile | null>(this.viewerPath, null);
    return data || null;
  }

  saveViewer(viewer: ViewerProfile): ViewerProfile {
    this.writeJson(this.viewerPath, viewer);
    // also mirror into settings for legacy consumers
    const current = this.getSettings();
    this.writeJson(this.settingsPath, { ...current, userProfile: viewer });
    return viewer;
  }

  saveLastScan(count: number) {
    const now = new Date().toISOString();
    const settings = this.getSettings();
    const updated: Settings = { ...settings, lastScan: { at: now, count } };
    this.writeJson(this.settingsPath, updated);
    return updated;
  }

  getExportIndex(): ExportIndexRecord {
    const { data, changed } = this.readJson<ExportIndexRecord>(this.indexPath, { exports: [] });
    const rawExports = Array.isArray((data as any).exports) ? (data as any).exports : [];
    const validated = rawExports
      .map((e: ExportIndexEntry) => this.validateExportEntry(e))
      .filter((e: ExportIndexEntry | null): e is ExportIndexEntry => !!e);

    // annotate broken entries
  const withStatus = validated.map((entry: ExportIndexEntry) => {
      const missing: string[] = [];
      if (!fs.existsSync(entry.exportDirAbsolutePath)) missing.push('exportDir');
      if (!fs.existsSync(entry.transcriptPath)) missing.push('transcript');
      if (!fs.existsSync(entry.metaPath)) missing.push('meta');
      if (entry.summaryPath && !fs.existsSync(entry.summaryPath)) missing.push('summary');
      return { ...entry, broken: missing.length ? missing : undefined } as ExportIndexEntry;
    });

    const record: ExportIndexRecord = { exports: withStatus };
    if (changed || withStatus.length !== data.exports.length) {
      this.writeJson(this.indexPath, record);
    }
    return record;
  }

  recordExport(entry: Omit<ExportIndexEntry, 'id' | 'lastOpenedAt' | 'broken'> & { id?: string; lastOpenedAt?: string | null }): ExportIndexEntry {
    const record = this.getExportIndex();
    const id = entry.id || `${entry.chatId}-${Date.parse(entry.exportedAt) || Date.now()}`;
    const nextEntry: ExportIndexEntry = {
      ...entry,
      id,
      lastOpenedAt: entry.lastOpenedAt || null,
      broken: undefined,
    };

  const filtered = record.exports.filter((e: ExportIndexEntry) => e.id !== nextEntry.id && e.exportDirAbsolutePath !== nextEntry.exportDirAbsolutePath);
    const updated: ExportIndexRecord = { exports: [nextEntry, ...filtered].sort((a, b) => Date.parse(b.exportedAt) - Date.parse(a.exportedAt)) };
    this.writeJson(this.indexPath, updated);
    return nextEntry;
  }

  markOpened(id: string) {
    const record = this.getExportIndex();
    const now = new Date().toISOString();
  const updated = record.exports.map((e: ExportIndexEntry) => (e.id === id ? { ...e, lastOpenedAt: now } : e));
    this.writeJson(this.indexPath, { exports: updated });
  }

  removeEntry(id: string) {
    const record = this.getExportIndex();
  const updated = record.exports.filter((e: ExportIndexEntry) => e.id !== id);
    this.writeJson(this.indexPath, { exports: updated });
  }

  saveCharacterSnapshots(snapshots: CharacterSummary[]) {
    this.writeJson(this.characterCachePath, { snapshots, savedAt: new Date().toISOString() });
  }

  getCharacterSnapshots(): CharacterSummary[] {
    const { data } = this.readJson<{ snapshots: CharacterSummary[] }>(this.characterCachePath, { snapshots: [] });
    return Array.isArray(data.snapshots) ? data.snapshots : [];
  }

  saveChatsIndex(entries: ChatIndexEntry[]) {
    this.writeJson(this.chatsIndexPath, { entries, savedAt: new Date().toISOString() });
  }

  getChatsIndex(): ChatIndexEntry[] {
    const { data } = this.readJson<{ entries: ChatIndexEntry[] }>(this.chatsIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }

  saveCharactersIndex(entries: CharacterIndexEntry[]) {
    this.writeJson(this.charactersIndexPath, { entries, savedAt: new Date().toISOString() });
  }

  getCharactersIndex(): CharacterIndexEntry[] {
    const { data } = this.readJson<{ entries: CharacterIndexEntry[] }>(this.charactersIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }

  savePersonasIndex(entries: PersonaSummary[]) {
    this.writeJson(this.personasIndexPath, { entries, savedAt: new Date().toISOString() });
  }

  getPersonasIndex(): PersonaSummary[] {
    const { data } = this.readJson<{ entries: PersonaSummary[] }>(this.personasIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }

  saveVoicesIndex(entries: VoiceSummary[]) {
    this.writeJson(this.voicesIndexPath, { entries, savedAt: new Date().toISOString() });
  }

  getVoicesIndex(): VoiceSummary[] {
    const { data } = this.readJson<{ entries: VoiceSummary[] }>(this.voicesIndexPath, { entries: [] });
    return Array.isArray(data.entries) ? data.entries : [];
  }

  clearCaches() {
    try { if (fs.existsSync(this.characterCachePath)) fs.rmSync(this.characterCachePath, { force: true }); } catch {}
    const settings = this.getSettings();
    this.writeJson(this.settingsPath, { ...settings, userProfile: null });
    try { if (fs.existsSync(this.sessionPath)) fs.rmSync(this.sessionPath, { force: true }); } catch {}
    try { if (fs.existsSync(this.viewerPath)) fs.rmSync(this.viewerPath, { force: true }); } catch {}
  }

  // --- Session snapshot helpers ---
  loadSessionSnapshot(): SessionSnapshot | null {
    const fallback: SessionSnapshot = this.defaultSession();
    const { data, changed } = this.readJson<SessionSnapshot>(this.sessionPath, fallback);
    const validated = this.validateSnapshot(data || fallback);
    if (changed) this.writeJson(this.sessionPath, validated);
    return validated;
  }

  saveSessionSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
    const sanitized = this.validateSnapshot(snapshot);
    this.writeJson(this.sessionPath, sanitized);
    return sanitized;
  }

  updateSessionSnapshot(patch: Partial<SessionSnapshot>): SessionSnapshot {
    const current = this.loadSessionSnapshot() || this.defaultSession();
    const merged: SessionSnapshot = {
      ...current,
      ...patch,
      viewer: patch.viewer !== undefined ? patch.viewer : current.viewer,
      characters: patch.characters !== undefined ? patch.characters : current.characters,
      creators: patch.creators !== undefined ? patch.creators : current.creators,
      personas: patch.personas !== undefined ? patch.personas : current.personas,
      voices: patch.voices !== undefined ? patch.voices : current.voices,
      chats: patch.chats !== undefined ? patch.chats : current.chats,
      freshness: this.mergeFreshness(current.freshness, patch.freshness),
    };
    return this.saveSessionSnapshot(merged);
  }

  markSectionUpdated(section: string, timestamp?: string) {
    const ts = timestamp || new Date().toISOString();
    const current = this.loadSessionSnapshot() || this.defaultSession();
    const nextFreshness: Freshness = {
      lastUpdated: ts,
      sections: { ...(current.freshness.sections || {}), [section]: ts },
    };
    return this.saveSessionSnapshot({ ...current, freshness: nextFreshness });
  }

  validateSnapshot(raw: SessionSnapshot): SessionSnapshot {
    const safe = raw || this.defaultSession();
    return {
      viewer: safe.viewer || null,
      characters: Array.isArray(safe.characters) ? safe.characters : [],
      creators: safe.creators && typeof safe.creators === 'object' ? safe.creators : {},
      personas: Array.isArray(safe.personas) ? safe.personas : [],
      voices: Array.isArray(safe.voices) ? safe.voices : [],
      chats: Array.isArray(safe.chats) ? safe.chats : [],
      freshness: this.mergeFreshness({ lastUpdated: null, sections: {} }, safe.freshness),
    };
  }

  private defaultSession(): SessionSnapshot {
    return {
      viewer: null,
      characters: [],
      creators: {},
      personas: [],
      voices: [],
      chats: [],
      freshness: { lastUpdated: null, sections: {} },
    };
  }

  private mergeFreshness(base: Freshness, incoming?: Freshness): Freshness {
    return {
      lastUpdated: incoming?.lastUpdated ?? base.lastUpdated ?? null,
      sections: { ...(base.sections || {}), ...(incoming?.sections || {}) },
    };
  }

  private validateExportEntry(raw: any): ExportIndexEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const required = ['chatId', 'characterName', 'exportedAt', 'exportDirAbsolutePath', 'messageCount', 'transcriptPath', 'metaPath'];
    for (const key of required) {
      if (!(key in raw)) return null;
    }
    return {
      id: typeof raw.id === 'string' ? raw.id : `${raw.chatId}-${Date.parse(raw.exportedAt) || Date.now()}`,
      chatId: String(raw.chatId),
      chatUrl: raw.chatUrl ? String(raw.chatUrl) : null,
      characterName: String(raw.characterName),
      characterAvatarUrl: raw.characterAvatarUrl ?? null,
      viewerHandle: raw.viewerHandle ? String(raw.viewerHandle) : null,
      exportedAt: String(raw.exportedAt),
      createdAt: raw.createdAt ? String(raw.createdAt) : null,
      exportDirAbsolutePath: String(raw.exportDirAbsolutePath),
      messageCount: Number(raw.messageCount) || 0,
      summaryPath: raw.summaryPath || null,
      transcriptPath: String(raw.transcriptPath),
      metaPath: String(raw.metaPath),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
      lastOpenedAt: raw.lastOpenedAt ? String(raw.lastOpenedAt) : null,
      broken: undefined,
    };
  }

  private ensureDirs() {
    if (!fs.existsSync(this.storageDir)) fs.mkdirSync(this.storageDir, { recursive: true });
    if (!fs.existsSync(this.profileDir)) fs.mkdirSync(this.profileDir, { recursive: true });
  }

  private readJson<T>(filePath: string, fallback: T): LoadResult<T> {
    try {
      if (!fs.existsSync(filePath)) return { data: fallback, changed: true };
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { data: parsed as T, changed: false };
    } catch (e) {
      return { data: fallback, changed: true };
    }
  }

  private writeJson(filePath: string, data: any) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
