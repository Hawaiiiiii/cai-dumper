export interface ChatMessage {
  turn_index: number;
  role: 'user' | 'char' | 'system';
  name: string;
  text: string;
  timestamp?: string;
}

export interface CharacterSnapshot {
  chatId: string;
  displayName: string;
  handle?: string | null;
  avatarUrl?: string | null;
  interactionCount?: number | null;
  lastActivityLabel?: string | null;
  url: string;
  preview?: string | null;
}

export interface ViewerProfile {
  handle: string;           // @handle
  displayName: string;      // user-facing name
  avatarUrl?: string | null;
  isPlus?: boolean;         // c.ai+ subscriber status
  followers?: string | number | null;
  following?: string | number | null;
  interactions?: string | number | null;
  profileUrl?: string | null;
  updatedAt: string;
  source: 'dom' | 'embedded-json';
}

export interface CreatorProfile {
  username: string; // handle without @
  avatarUrl?: string | null;
  followers?: number | null;
  following?: number | null;
  interactions?: number | null;
  fetchedAt: string;
}

export interface CreatorProfileMini {
  handle?: string;        // "@N035"
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
}

export interface CharacterSummary {
  characterId: string;
  chatId: string;
  displayName: string;
  avatarUrl?: string | null;
  tagline?: string | null;
  interactions?: string | number | null;
  likes?: string | number | null;
  creator?: CreatorProfileMini | null;
  handle?: string;
  lastChatDate?: string;
  lastSeenLabel?: string | null;
  url: string;
  preview?: string | null;
  updatedAt?: string | null;
}

export interface CharacterIndexEntry {
  characterId?: string | null;
  name: string;
  avatarUrl?: string | null;
  tagline?: string | null;
  interactions?: number | null;
  creatorHandle?: string | null;
  profileUrl?: string | null;
  updatedAt: string;
}

export interface PersonaSummary {
  id: string;
  displayName: string;
  description?: string | null;
  avatarUrl?: string | null;
}

export interface VoiceSummary {
  id: string;
  displayName: string;
  description?: string | null;
}

export interface ChatIndexEntry {
  chatId: string;
  chatUrl: string;
  characterName?: string | null;
  avatarUrl?: string | null;
  lastSeenLabel?: string | null;
  updatedAt: string;
}

export type QAStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface QACheckResult {
  id: string;
  name: string;
  status: QAStatus;
  message: string;
  details?: Record<string, unknown> | null;
  timestamp: string;
}

export interface QAReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  url?: string;
  checks: QACheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    info: number;
  };
}

export interface QAMonitorState {
  active: boolean;
  lastReport: QAReport | null;
}

export interface ChatSummary {
  id: string;
  characterId?: string | null;
  title?: string | null;
  lastUpdated?: string | null;
}

export interface Freshness {
  lastUpdated?: string | null;
  sections?: Record<string, string | null>;
}

export interface SessionSnapshot {
  viewer: ViewerProfile | null;
  characters: CharacterSummary[];
  creators: Record<string, CreatorProfile>;
  personas: PersonaSummary[];
  voices: VoiceSummary[];
  chats: ChatSummary[];
  freshness: Freshness;
}

export interface ExportIndexEntry {
  id: string;
  chatId: string;
  chatUrl?: string | null;
  characterName: string;
  characterAvatarUrl: string | null;
  viewerHandle?: string | null;
  exportedAt: string;
  createdAt?: string | null;
  exportDirAbsolutePath: string;
  messageCount: number;
  summaryPath: string | null;
  transcriptPath: string;
  metaPath: string;
  tags?: string[];
  lastOpenedAt: string | null;
  broken?: string[];
}

export type TranscriptSender = 'viewer' | 'character' | 'system' | 'unknown';

export interface TranscriptAttachment {
  type: 'image' | 'audio' | 'other';
  url?: string | null;
  localPath?: string | null;
}

export interface TranscriptMessage {
  id: string;
  ts: string | null;
  sender: TranscriptSender;
  name?: string | null;
  text: string;
  attachments?: TranscriptAttachment[];
  raw?: any;
}

export interface TimelineBucket {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface TranscriptInsights {
  totalMessages: number;
  viewerMessages: number;
  characterMessages: number;
  avgCharsPerMessage: number;
  avgWordsPerMessage: number;
  timelineBuckets: TimelineBucket[];
  warnings?: string[];
}

export interface ExportIndexRecord {
  exports: ExportIndexEntry[];
}

export interface Settings {
  exportRootPath: string;
  lastAccountProfileUrl: string | null;
  ui: {
    theme?: string | null;
    accent?: string | null;
    wallpaper?: string | null;
  };
  verboseLogs?: boolean;
  lastScan: { at: string; count: number } | null;
  userProfile?: ViewerProfile | null;
}

export interface ChatExport {
  id: string;
  character_name: string;
  messages: ChatMessage[];
  metadata?: {
    exported_at: string;
    source_url: string;
  };
}

export enum AnalysisType {
  SUMMARY = 'SUMMARY',
  TIMELINE = 'TIMELINE',
  CONSISTENCY = 'CONSISTENCY',
  CHAPTERS = 'CHAPTERS'
}

export interface AnalysisResult {
  type: AnalysisType;
  markdown: string;
  timestamp: string;
}

export type ViewState = 'DASHBOARD' | 'SCRAPER' | 'VIEWER' | 'ANALYSIS' | 'ARCHITECTURE';

export interface CharacterCardData {
  id: string;
  name: string;
  creator?: string;
  creatorAvatarUrl?: string | null;
  interactions?: string | number;
  likes?: string | number;
  lastChat?: string;
  avatarUrl?: string;
  url?: string;
}

export interface IElectronAPI {
  launchBrowser: () => Promise<boolean>;
  checkBrowserStatus: () => Promise<boolean>;
  fetchChats: () => Promise<any>;
  exportChat: (url: string, characterName: string, reverseTranscript?: boolean, avatarUrl?: string) => Promise<{path: string, count: number, recorded?: any, analysisSkipped?: boolean, warning?: string}>;
  runAnalysis: (folderPath: string) => Promise<string>;
  testSelectors: () => Promise<any>;
  openFolder: (path: string) => Promise<void>;
  openPathInExplorer: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  getExportIndex: () => Promise<{ exports: ExportIndexEntry[] }>;
  listExportsForChat: (chatId: string) => Promise<ExportIndexEntry[]>;
  readTranscript: (pathOrDir: string, maxLines?: number) => Promise<{ transcriptPath: string; messages: TranscriptMessage[]; warnings?: string[] }>;
  readTranscriptPage: (
    transcriptPath: string,
    opts: { direction: 'older' | 'newer'; fromLine?: number; pageSize: number; currentMaxLines?: number }
  ) => Promise<{ transcriptPath: string; messages: TranscriptMessage[]; warnings?: string[]; maxLines: number; truncated: boolean }>;
  readSummary: (summaryPath: string) => Promise<string>;
  computeInsightsFromTranscript: (transcriptPath: string, maxLines?: number) => Promise<TranscriptInsights>;
  removeExportEntry: (id: string) => Promise<{ exports: ExportIndexEntry[] }>;
  markExportOpened: (id: string) => Promise<{ exports: ExportIndexEntry[] }>;
  getProfileDir: () => Promise<string>;
  getCharacterCache: () => Promise<any>;
  getUserProfile: () => Promise<ViewerProfile | null>;
  getViewer: () => Promise<ViewerProfile | null>;
  refreshViewer: () => Promise<{ session: SessionSnapshot | null; profile: ViewerProfile | null }>;
  getChatsIndex: () => Promise<ChatIndexEntry[]>;
  hydrateChatsMetadata: (urls: string[], limit?: number) => Promise<{ cancelled: boolean; metadata: any[] }>;
  cancelHydrate: () => Promise<{ cancelled: boolean }>;
  refreshCharactersFromProfile: (sortMode?: string) => Promise<CharacterIndexEntry[]>;
  getCharactersIndex: () => Promise<CharacterIndexEntry[]>;
  getPersonasIndex: () => Promise<PersonaSummary[]>;
  getVoicesIndex: () => Promise<VoiceSummary[]>;
  refreshPersonasIndex: (opts?: { maxItems?: number }) => Promise<{ cancelled: boolean; entries: PersonaSummary[] }>;
  refreshVoicesIndex: (opts?: { maxItems?: number }) => Promise<{ cancelled: boolean; entries: VoiceSummary[] }>;
  cancelProfileIndex: () => Promise<{ cancelled: boolean }>;
  getSession: () => Promise<SessionSnapshot>;
  saveSession: (patch: Partial<SessionSnapshot>) => Promise<SessionSnapshot>;
  refreshViewerProfile: () => Promise<{ session: SessionSnapshot | null; profile: ViewerProfile | null }>;
  refreshCreatorProfiles: (names: string[]) => Promise<{ session: SessionSnapshot | null; updated: number; message?: string }>;
  refreshSidebarScan: () => Promise<{ viewer: ViewerProfile | null; chats: ChatIndexEntry[] }>;
  getSettings: () => Promise<Settings>;
  saveSettings: (partial: Partial<Settings>) => Promise<Settings>;
  chooseExportRoot: () => Promise<Settings>;
  resetBrowserProfile: () => Promise<{ profileDir: string }>;
  showBrowserView: (rect: { x: number, y: number, width: number, height: number }) => Promise<void>;
  hideBrowserView: () => Promise<void>;
  resizeBrowserView: (rect: { x: number, y: number, width: number, height: number }) => Promise<void>;
  setAlwaysOnTop: (flag: boolean) => Promise<void>;
  detachBrowser: () => Promise<void>;
  attachBrowser: () => Promise<void>;
  saveLogs: (logs: string[]) => Promise<{ success: boolean; path?: string; error?: string }>;
  scrapeCurrentPage: () => Promise<{ success: boolean; message: string; data?: any }>;
  scrapeFollowersList: (type: 'followers' | 'following') => Promise<any>;
  runDiagnostics: () => Promise<QAReport>;
  testScroll: () => Promise<{ success?: boolean; error?: string }>;
  startQAMonitor: (intervalMs?: number) => Promise<QAMonitorState>;
  stopQAMonitor: () => Promise<QAMonitorState>;
  getQAState: () => Promise<QAMonitorState>;
  qaOverlay: (enable: boolean) => Promise<{ results: any[] }>;
  forceScrollProbe: () => Promise<{ results: any[] }>;
  saveQASnapshot: () => Promise<{ path: string }>;
  
  onScraperLog: (callback: (log: string) => void) => void;
  onAnalysisLog: (callback: (log: string) => void) => void;
  onExportIndexUpdate: (callback: (data: { exports: ExportIndexEntry[] }) => void) => void;
  onCharactersIndexUpdate: (callback: (data: CharacterIndexEntry[]) => void) => void;
  onPersonasIndexUpdate: (callback: (data: PersonaSummary[]) => void) => void;
  onVoicesIndexUpdate: (callback: (data: VoiceSummary[]) => void) => void;
  onHydrateProgress: (callback: (data: any) => void) => void;
  onCreatorHydrateProgress: (callback: (data: any) => void) => void;
  onCreatorsIndexUpdate: (callback: (data: Record<string, any>) => void) => void;
  onSessionUpdated: (callback: (data: SessionSnapshot) => void) => void;
  onBrowserDetachedClosed: (callback: () => void) => void;
  onQAReport: (callback: (report: QAReport) => void) => void;
  
  exportDiagnostics: () => Promise<string>;
  cancelJob: () => Promise<void>;
  onJobStatus: (cb: (status: { busy: boolean, current: any }) => void) => void;
  toggleSnow: (enable: boolean) => Promise<void>;
}
