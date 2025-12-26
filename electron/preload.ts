import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  launchBrowser: () => ipcRenderer.invoke('launch-browser'),
  fetchChats: () => ipcRenderer.invoke('fetch-chats'),
  exportChat: (url: string, characterName: string, reverseTranscript?: boolean) => ipcRenderer.invoke('export-chat', { url, characterName, reverseTranscript }),
  runAnalysis: (folderPath: string) => ipcRenderer.invoke('run-analysis', { folderPath }),
  testSelectors: () => ipcRenderer.invoke('test-selectors'),
  openFolder: (path: string) => ipcRenderer.invoke('open-folder', path),
  onScraperLog: (callback: (log: string) => void) => ipcRenderer.on('scraper-log', (_event, value) => callback(value)),
  onAnalysisLog: (callback: (log: string) => void) => ipcRenderer.on('analysis-log', (_event, value) => callback(value)),
});
