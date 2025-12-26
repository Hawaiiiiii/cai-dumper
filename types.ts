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
  followers?: number | null;
  following?: number | null;
  interactions?: number | null;
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
  interactions?: number | null;
  creator?: CreatorProfileMini | null;
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
