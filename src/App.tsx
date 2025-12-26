import React, { useState, useEffect } from 'react';
import { Terminal, Play, Download, FolderOpen, Bot, FileText, BrainCircuit } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [chats, setChats] = useState<any[]>([]);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("Ready");
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_key') || '');
  const [draft, setDraft] = useState('');
  const [reverseTranscript, setReverseTranscript] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  useEffect(() => {
    window.electronAPI.onScraperLog((msg) => addLog(`[Scraper] ${msg}`));
    window.electronAPI.onAnalysisLog((msg) => addLog(`[Analysis] ${msg}`));
  }, []);

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-100), msg]);

  const handleLaunch = async () => {
    setStatus("Launching Browser...");
    await window.electronAPI.launchBrowser();
    setStatus("Browser Open. Log in manually.");
  };

  const handleFetch = async () => {
    setStatus("Scanning Sidebar...");
    const results = await window.electronAPI.fetchChats();
    setChats(results);
    setStatus(`Found ${results.length} chats.`);
  };

  const handleTestSelectors = async () => {
    setStatus("Testing selectors...");
    try {
      const res = await window.electronAPI.testSelectors();
      setTestResult(res);
      addLog(`[TestSelectors] URL: ${res.url}`);
      res.selectorResults?.forEach((r: any) => {
        addLog(`[TestSelectors] ${r.name}: ${r.count} nodes`);
      });
    } catch (e: any) {
      addLog(`TestSelectors error: ${e.message}`);
    } finally {
      setStatus("Ready");
    }
  };

  const handleExport = async () => {
    setStatus("Exporting...");
    for (const url of selectedChats) {
      const chat = chats.find(c => c.url === url);
      if (chat) {
        addLog(`Starting export for ${chat.name}...`);
        try {
          const res = await window.electronAPI.exportChat(chat.url, chat.name, reverseTranscript);
          addLog(`Exported ${res.count} messages to ${res.path}`);
          
          if (res.analysisSkipped || res.count === 0) {
            addLog(res.warning || "Export produced 0 messages; skipping analysis. Run 'Test selectors' to debug extraction.");
          } else {
            // Auto-run analysis
            addLog("Running Python Analysis...");
            await window.electronAPI.runAnalysis(res.path);
          }
          
        } catch (e: any) {
          addLog(`Error: ${e.message}`);
        }
      }
    }
    setStatus("Done.");
  };

  const handleDraft = async () => {
    if (!apiKey) return alert("Please set API Key");
    setStatus("AI Thinking...");
    try {
        const client = new GoogleGenAI({ apiKey });
        const response = await client.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `
            You are a roleplay assistant. 
            Draft a continuation for a character roleplay based on generic context.
            Provide 3 distinct options for the user to say next.
        `});
        setDraft(response.text || '');
    } catch(e: any) {
        addLog(`AI Error: ${e.message}`);
    } finally {
        setStatus("Ready");
    }
  };

  const toggleChat = (url: string) => {
    const next = new Set(selectedChats);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setSelectedChats(next);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar Controls */}
      <div className="w-80 bg-gray-900 border-r border-gray-800 p-6 flex flex-col gap-6">
        <h1 className="text-xl font-bold text-amber-500 flex items-center gap-2">
          <Bot /> CAI Dumper V1
        </h1>
        
        <div className="space-y-4">
          <button onClick={handleLaunch} className="w-full btn bg-blue-600 hover:bg-blue-500 p-3 rounded flex gap-2 items-center justify-center font-semibold">
            <Play size={18} /> Launch Browser
          </button>
          
          <button onClick={handleFetch} className="w-full btn bg-gray-700 hover:bg-gray-600 p-3 rounded flex gap-2 items-center justify-center font-semibold">
            <FolderOpen size={18} /> Scan Sidebar
          </button>

          <button onClick={handleTestSelectors} className="w-full btn bg-amber-700 hover:bg-amber-600 p-3 rounded flex gap-2 items-center justify-center font-semibold">
            <Terminal size={18} /> Test Selectors
          </button>

          <button 
            onClick={handleExport} 
            disabled={selectedChats.size === 0}
            className="w-full btn bg-green-600 hover:bg-green-500 disabled:opacity-50 p-3 rounded flex gap-2 items-center justify-center font-semibold"
          >
            <Download size={18} /> Export Selected ({selectedChats.size})
          </button>

          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={reverseTranscript} onChange={(e) => setReverseTranscript(e.target.checked)} />
            Reverse transcript order
          </label>
        </div>

        <div className="mt-auto border-t border-gray-800 pt-4">
            <label className="text-xs text-gray-500 mb-1 block">Gemini API Key (Optional)</label>
            <input 
                type="password" 
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('gemini_key', e.target.value) }}
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm"
                placeholder="sk-..."
            />
             <button onClick={handleDraft} className="w-full mt-2 btn bg-purple-900/50 border border-purple-500/50 hover:bg-purple-900 p-2 rounded text-sm text-purple-200">
                <BrainCircuit size={14} className="inline mr-1"/> AI Draft Helper
             </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col bg-gray-950">
        <div className="h-12 border-b border-gray-800 flex items-center px-4 bg-gray-900">
            <span className="text-sm text-gray-400 font-mono">Status: {status}</span>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
            {chats.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-600">
                    <FileText size={48} className="mb-4 opacity-20" />
                    <p>No chats found. Launch browser and scan.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-2">
                    {chats.map(chat => (
                        <div key={chat.url} className={`p-3 border rounded cursor-pointer flex items-center gap-3 ${selectedChats.has(chat.url) ? 'bg-amber-900/20 border-amber-500/50' : 'bg-gray-900 border-gray-800'}`} onClick={() => toggleChat(chat.url)}>
                            <input type="checkbox" checked={selectedChats.has(chat.url)} readOnly className="w-4 h-4" />
                            <div>
                                <h3 className="font-semibold text-gray-200">{chat.name}</h3>
                                <p className="text-xs text-gray-500 truncate w-96">{chat.preview}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
        
        {/* Terminal / Logs */}
        <div className="h-64 bg-black border-t border-gray-800 p-4 font-mono text-xs overflow-y-auto text-green-400">
            <div className="flex items-center gap-2 mb-2 text-gray-500 sticky top-0 bg-black w-full pb-2 border-b border-gray-900">
                <Terminal size={14} /> System Logs
            </div>
            {logs.map((l, i) => <div key={i}>{l}</div>)}
             <div id="log-end" ref={(el) => el?.scrollIntoView({ behavior: "smooth" })} />
        </div>
      </div>

      {/* AI Draft Drawer (Overlay) */}
      {draft && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-purple-500 p-6 rounded-xl shadow-2xl max-w-lg w-full">
            <h3 className="text-purple-400 font-bold mb-4">Gemini Suggestions</h3>
            <div className="whitespace-pre-wrap text-sm text-gray-300">{draft}</div>
            <button onClick={() => setDraft('')} className="mt-4 w-full p-2 bg-gray-800 rounded">Close</button>
        </div>
      )}

      {testResult && (
        <div className="absolute bottom-4 right-4 bg-gray-900 border border-amber-600 p-4 rounded shadow-lg max-w-xl w-[30rem] text-sm text-gray-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-amber-400 font-semibold">Selector Diagnostics</span>
            <button className="text-gray-400 hover:text-white" onClick={() => setTestResult(null)}>Close</button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            <div className="text-xs text-gray-400">URL: {testResult.url}</div>
            <div className="text-xs text-gray-400">Sidebar links: {testResult.sidebarLinks}</div>
            {testResult.selectedScroll && (
              <div className="text-xs text-gray-400">Scroll container: idx {testResult.selectedScroll.idx} (h={testResult.selectedScroll.height}, visible={testResult.selectedScroll.visibleHeight})</div>
            )}
            {(testResult.selectorResults || []).map((r: any) => (
              <div key={r.name} className="border border-gray-800 rounded p-2">
                <div className="font-mono text-xs">{r.name}: {r.count} nodes</div>
                {r.sampleTexts?.length > 0 && (
                  <div className="text-xs text-gray-400">Samples: {r.sampleTexts.join(' | ')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}