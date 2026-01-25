import React, { useEffect, useState } from 'react';
import { Settings, Monitor, Folder, Database, Shield, Save } from 'lucide-react';

export default function SettingsPanel() {
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [testsRunning, setTestsRunning] = useState(false);
  const [qaActive, setQaActive] = useState(false);
  const [qaReport, setQaReport] = useState<any>(null);
  const [qaOverlayEnabled, setQaOverlayEnabled] = useState(false);
  const [qaProbeResult, setQaProbeResult] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.getSettings().then((s: any) => {
        setSettings(s);
        setLoading(false);
    });
  }, []);

  useEffect(() => {
    window.electronAPI.getQAState?.().then((state: any) => {
      if (state) {
        setQaActive(Boolean(state.active));
        setQaReport(state.lastReport || null);
      }
    });

    window.electronAPI.onQAReport?.((report: any) => {
      setQaReport(report);
    });
  }, []);

  const handleSave = (key: string, value: any) => {
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);
      window.electronAPI.saveSettings({ [key]: value });
  };

  const handleChooseFolder = async () => {
      const res = await window.electronAPI.chooseExportRoot();
      if (res && res.exportRootPath) {
          setSettings(res);
      }
  };

  const handleDiagnostics = () => {
    setDiagResult('Running...');
    window.electronAPI.runDiagnostics().then((r: any) => setDiagResult(JSON.stringify(r, null, 2)));
  };

  const handleTestScroll = () => {
    window.electronAPI.testScroll().then((r: any) => {
      alert(r.success ? "Scroll Test Passed! Check valid window." : "Scroll Test Failed: " + (r.error || "No container found"));
    });
  };

  const handleToggleOverlay = async () => {
    setTestsRunning(true);
    try {
      const next = !qaOverlayEnabled;
      await window.electronAPI.qaOverlay(next);
      setQaOverlayEnabled(next);
    } finally {
      setTestsRunning(false);
    }
  };

  const handleForceScrollProbe = async () => {
    setTestsRunning(true);
    try {
      const res = await window.electronAPI.forceScrollProbe();
      setQaProbeResult(JSON.stringify(res, null, 2));
    } finally {
      setTestsRunning(false);
    }
  };

  const handleSaveSnapshot = async () => {
    setTestsRunning(true);
    try {
      const res = await window.electronAPI.saveQASnapshot();
      setDiagResult(`Saved QA snapshot: ${res.path}`);
    } finally {
      setTestsRunning(false);
    }
  };

  const handleStartLiveQA = async () => {
    setTestsRunning(true);
    try {
      const state = await window.electronAPI.startQAMonitor?.(3000);
      if (state) {
        setQaActive(Boolean(state.active));
        setQaReport(state.lastReport || null);
      }
    } finally {
      setTestsRunning(false);
    }
  };

  const handleStopLiveQA = async () => {
    setTestsRunning(true);
    try {
      const state = await window.electronAPI.stopQAMonitor?.();
      if (state) {
        setQaActive(Boolean(state.active));
        setQaReport(state.lastReport || null);
      }
    } finally {
      setTestsRunning(false);
    }
  };

  // Placeholder log function if not available
  const addLog = (msg: string) => { console.log(msg); };

  if (loading) return <div className="p-8 text-zinc-500">Loading settings...</div>;

  return (
    <div className="flex-1 bg-[#09090b] p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-400">
            <Settings size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-zinc-400">Manage application preferences and storage</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Appearance Section */}
          <section className="bg-[#121214] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
              <Monitor size={18} className="text-blue-400" />
              <h2 className="font-medium text-white">Appearance</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-zinc-200">Theme</div>
                  <div className="text-xs text-zinc-500">Select your preferred interface theme</div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 italic">Only Dark Mode supported currently</span>
                    <select 
                        value="dark"
                        disabled
                        className="bg-zinc-900 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-500 outline-none cursor-not-allowed"
                    >
                    <option value="dark">Dark (Default)</option>
                    </select>
                </div>
              </div>
            </div>
          </section>

          {/* Window Settings */}
          <section className="bg-[#121214] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
              <Monitor size={18} className="text-purple-400" />
              <h2 className="font-medium text-white">Window</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-zinc-200">Always on Top</div>
                  <div className="text-xs text-zinc-500">Keep the application window above others</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={settings.alwaysOnTop || false}
                    onChange={(e) => {
                        handleSave('alwaysOnTop', e.target.checked);
                        window.electronAPI.setAlwaysOnTop(e.target.checked);
                    }}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </section>

          {/* Storage Section */}
          <section className="bg-[#121214] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
              <Folder size={18} className="text-yellow-400" />
              <h2 className="font-medium text-white">Storage & Exports</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-200">Export Location</div>
                  <div className="text-xs text-zinc-500">Where your chat dumps are saved</div>
                </div>
                
                <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 bg-zinc-900 px-3 py-2 rounded-lg border border-white/5 text-xs font-mono text-zinc-300 break-all">
                        {settings.exportRootPath || 'Default Location'}
                    </div>
                    <button 
                        onClick={handleChooseFolder}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                        Change Folder
                    </button>
                </div>
              </div>
            </div>
          </section>

          {/* Data Section */}
          <section className="bg-[#121214] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
              <Database size={18} className="text-purple-400" />
              <h2 className="font-medium text-white">Data Management</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-zinc-200">Clear Cache</div>
                  <div className="text-xs text-zinc-500">Free up disk space by removing temporary files</div>
                </div>
                <button className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors">
                  Clear Cache
                </button>
              </div>
            </div>
          </section>

          {/* Diagnostics Section */}
          <section className="bg-[#121214] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
              <Shield size={18} className="text-red-400" />
              <h2 className="font-medium text-white">Diagnostics & QA</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-col gap-3">
                 <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-zinc-200">System Check</div>
                      <div className="text-xs text-zinc-500">Run self-diagnostics to verify scraper health</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDiagnostics}
                        disabled={testsRunning}
                        className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        {testsRunning ? 'Running...' : 'Run Diagnostics'}
                      </button>
                      
                      <button
                        onClick={handleTestScroll}
                        disabled={testsRunning}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        Test Scroll
                      </button>

                      <button
                        onClick={async () => {
                            setTestsRunning(true);
                            try {
                                const api = (window as any).electron || (window as any).electronAPI;
                                if (api && api.launchBrowser) {
                                    await api.launchBrowser();
                                }
                            } catch(e: any) {
                                console.error(e);
                            }
                            setTestsRunning(false);
                        }}
                        disabled={testsRunning}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        Open Browser
                      </button>
                    </div>
                 </div>
                 <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-zinc-200">Live QA Monitor</div>
                      <div className="text-xs text-zinc-500">Stream diagnostics every few seconds</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleStartLiveQA}
                        disabled={testsRunning || qaActive}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        {qaActive ? 'Live QA Running' : 'Start Live QA'}
                      </button>
                      <button
                        onClick={handleStopLiveQA}
                        disabled={testsRunning || !qaActive}
                        className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        Stop Live QA
                      </button>
                    </div>
                 </div>
                 <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-zinc-200">QA Overlay</div>
                      <div className="text-xs text-zinc-500">Highlight detected scroll container</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleToggleOverlay}
                        disabled={testsRunning}
                        className="flex-1 bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        {qaOverlayEnabled ? 'Hide Overlay' : 'Show Overlay'}
                      </button>
                      <button
                        onClick={handleForceScrollProbe}
                        disabled={testsRunning}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        Force-Scroll Probe
                      </button>
                      <button
                        onClick={handleSaveSnapshot}
                        disabled={testsRunning}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50"
                      >
                        Save QA Snapshot
                      </button>
                    </div>
                 </div>
                 {diagResult && (
                     <pre className="mt-2 text-[10px] bg-black/50 p-2 rounded border border-white/10 overflow-x-auto text-zinc-400">
                         {diagResult}
                     </pre>
                 )}
                 {qaReport && (
                     <pre className="mt-2 text-[10px] bg-black/50 p-2 rounded border border-white/10 overflow-x-auto text-zinc-400">
                         {JSON.stringify(qaReport, null, 2)}
                     </pre>
                 )}
                 {qaProbeResult && (
                     <pre className="mt-2 text-[10px] bg-black/50 p-2 rounded border border-white/10 overflow-x-auto text-zinc-400">
                         {qaProbeResult}
                     </pre>
                 )}
              </div>
            </div>
          </section>

          {/* About Section */}
          <section className="bg-[#121214] border border-white/5 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
              <Shield size={18} className="text-green-400" />
              <h2 className="font-medium text-white">About</h2>
            </div>
            <div className="p-6">
              <div className="text-sm text-zinc-400">
                <p>CAI Dumper v1.0.0-beta</p>
                <p className="mt-1">A local-first tool for archiving and analyzing Character.AI chats.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
