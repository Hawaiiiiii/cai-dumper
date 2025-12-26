export interface IElectronAPI {
  launchBrowser: () => Promise<boolean>;
  fetchChats: () => Promise<any[]>;
  exportChat: (url: string, characterName: string, reverseTranscript?: boolean) => Promise<{path: string, count: number, analysisSkipped?: boolean, warning?: string}>;
  runAnalysis: (folderPath: string) => Promise<string>;
  testSelectors: () => Promise<any>;
  openFolder: (path: string) => Promise<void>;
  onScraperLog: (callback: (log: string) => void) => void;
  onAnalysisLog: (callback: (log: string) => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}