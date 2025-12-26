import { SessionSnapshot, ViewerProfile, ChatIndexEntry, CharacterIndexEntry, ExportIndexEntry, TranscriptInsights, TranscriptMessage, PersonaSummary, VoiceSummary } from '../types';

export interface IElectronAPI {
  launchBrowser: () => Promise<boolean>;
  fetchChats: () => Promise<any[]>;
  exportChat: (url: string, characterName: string, reverseTranscript?: boolean, avatarUrl?: string) => Promise<{path: string, count: number, recorded?: any, analysisSkipped?: boolean, warning?: string}>;
  runAnalysis: (folderPath: string) => Promise<string>;
  testSelectors: () => Promise<any>;
  openFolder: (path: string) => Promise<void>;
  openPathInExplorer: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  getExportIndex: () => Promise<any>;
  listExportsForChat: (chatId: string) => Promise<ExportIndexEntry[]>;
  readTranscript: (pathOrDir: string, maxLines?: number) => Promise<{ transcriptPath: string; messages: TranscriptMessage[]; warnings?: string[] }>;
  readTranscriptPage: (
    transcriptPath: string,
    opts: { direction: 'older' | 'newer'; fromLine?: number; pageSize: number; currentMaxLines?: number }
  ) => Promise<{ transcriptPath: string; messages: TranscriptMessage[]; warnings?: string[]; maxLines: number; truncated: boolean }>;
  readSummary: (summaryPath: string) => Promise<string>;
  computeInsightsFromTranscript: (transcriptPath: string, maxLines?: number) => Promise<TranscriptInsights>;
  removeExportEntry: (id: string) => Promise<any>;
  markExportOpened: (id: string) => Promise<any>;
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
  refreshSidebarScan: () => Promise<SessionSnapshot>;
  getSettings: () => Promise<any>;
  saveSettings: (partial: any) => Promise<any>;
  chooseExportRoot: () => Promise<any>;
  resetBrowserProfile: () => Promise<{ profileDir: string }>;
  onScraperLog: (callback: (log: string) => void) => void;
  onAnalysisLog: (callback: (log: string) => void) => void;
  onExportIndexUpdate: (callback: (data: any) => void) => void;
  onCharactersIndexUpdate: (callback: (data: CharacterIndexEntry[]) => void) => void;
  onPersonasIndexUpdate: (callback: (data: PersonaSummary[]) => void) => void;
  onVoicesIndexUpdate: (callback: (data: VoiceSummary[]) => void) => void;
  onHydrateProgress: (callback: (data: any) => void) => void;
  onCreatorHydrateProgress: (callback: (data: any) => void) => void;
  onCreatorsIndexUpdate: (callback: (data: Record<string, any>) => void) => void;
  onSessionUpdated: (callback: (data: SessionSnapshot) => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}