"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  launchBrowser: () => electron.ipcRenderer.invoke("launch-browser"),
  fetchChats: () => electron.ipcRenderer.invoke("fetch-chats"),
  exportChat: (url, characterName, reverseTranscript) => electron.ipcRenderer.invoke("export-chat", { url, characterName, reverseTranscript }),
  runAnalysis: (folderPath) => electron.ipcRenderer.invoke("run-analysis", { folderPath }),
  testSelectors: () => electron.ipcRenderer.invoke("test-selectors"),
  openFolder: (path) => electron.ipcRenderer.invoke("open-folder", path),
  onScraperLog: (callback) => electron.ipcRenderer.on("scraper-log", (_event, value) => callback(value)),
  onAnalysisLog: (callback) => electron.ipcRenderer.on("analysis-log", (_event, value) => callback(value))
});
