import React, { useState, useEffect, useMemo } from 'react';
import { Terminal, Play, FolderOpen, Bot, BrainCircuit, RefreshCw, Trash2, Folder, AlertTriangle, RefreshCw as RefreshIcon } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import AccountSidebar from './components/AccountSidebar';
import CharacterGrid from './components/CharacterGrid';
import { CharacterCardData } from './components/CharacterCard';
import ChatViewerPanel from './components/ChatViewerPanel';
import InsightsPanel from './components/InsightsPanel';
import { ChatMessage, ExportIndexEntry, Settings, SessionSnapshot, ViewerProfile, ChatIndexEntry, CharacterIndexEntry, TranscriptMessage, TranscriptInsights, PersonaSummary, VoiceSummary } from '../types';

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState("Ready");
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_key') || '');
  const [draft, setDraft] = useState('');
  const [reverseTranscript, setReverseTranscript] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [activeChat, setActiveChat] = useState<CharacterCardData | null>(null);
  const [viewerMessages, setViewerMessages] = useState<ChatMessage[]>([]);
  const [exportEntries, setExportEntries] = useState<ExportIndexEntry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profileDir, setProfileDir] = useState<string>('');
  const [userProfile, setUserProfile] = useState<ViewerProfile | null>(null);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [creatorsIndex, setCreatorsIndex] = useState<Record<string, any>>({});
  const [chatsIndex, setChatsIndex] = useState<ChatIndexEntry[]>([]);
  const [charactersIndex, setCharactersIndex] = useState<CharacterIndexEntry[]>([]);
  const [viewTab, setViewTab] = useState<'characters' | 'personas' | 'voices' | 'chats'>('characters');
  const [hydrating, setHydrating] = useState(false);
  const [hydrateProgress, setHydrateProgress] = useState<{ completed?: number; total?: number; cancelled?: boolean }>({});

  const [personasIndex, setPersonasIndex] = useState<PersonaSummary[]>([]);
  const [voicesIndex, setVoicesIndex] = useState<VoiceSummary[]>([]);
  const [profileIndexing, setProfileIndexing] = useState<null | 'personas' | 'voices'>(null);

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatExports, setChatExports] = useState<ExportIndexEntry[]>([]);
  const [selectedExport, setSelectedExport] = useState<ExportIndexEntry | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptMessage[] | null>(null);
  const [selectedInsights, setSelectedInsights] = useState<TranscriptInsights | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<string>('');
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [transcriptMaxLines, setTranscriptMaxLines] = useState(50_000);
  const [transcriptWarnings, setTranscriptWarnings] = useState<string[]>([]);
  const [transcriptTruncated, setTranscriptTruncated] = useState(false);

  useEffect(() => {
    window.electronAPI.onScraperLog((msg) => addLog(`[Scraper] ${msg}`));
    window.electronAPI.onAnalysisLog((msg) => addLog(`[Analysis] ${msg}`));
    window.electronAPI.onExportIndexUpdate((record) => setExportEntries(record?.exports || []));
    window.electronAPI.onSessionUpdated((snapshot) => {
      setSession(snapshot);
      setUserProfile(snapshot?.viewer || null);
    });
    window.electronAPI.onCharactersIndexUpdate((entries) => setCharactersIndex(entries || []));
    window.electronAPI.onPersonasIndexUpdate((entries) => setPersonasIndex(entries || []));
    window.electronAPI.onVoicesIndexUpdate((entries) => setVoicesIndex(entries || []));
    window.electronAPI.onHydrateProgress((p) => {
      setHydrateProgress(p || {});
      if (p?.cancelled) setHydrating(false);
    });
    window.electronAPI.onCreatorHydrateProgress((p) => {
      // Reuse the same progress state shape in UI; keeps changes minimal.
      setHydrateProgress(p || {});
      if (p?.cancelled) setHydrating(false);
    });
    window.electronAPI.onCreatorsIndexUpdate((idx) => {
      setCreatorsIndex((idx || {}) as any);
    });
  }, []);

  useEffect(() => {
    refreshSettings();
    refreshExportIndex();
    window.electronAPI.getProfileDir().then(setProfileDir);
    window.electronAPI.getChatsIndex().then(setChatsIndex);
    window.electronAPI.getCharactersIndex().then(setCharactersIndex);
  window.electronAPI.getPersonasIndex().then(setPersonasIndex);
  window.electronAPI.getVoicesIndex().then(setVoicesIndex);
    window.electronAPI.getViewer().then((v) => {
      if (v) setUserProfile(v);
      setSession((prev) => (prev ? { ...prev, viewer: v || prev.viewer } : prev));
    });
    window.electronAPI.getSession().then((s) => {
      setSession(s);
      setUserProfile(s?.viewer || null);
      setCreatorsIndex((s?.creators || {}) as any);
    });
  }, []);

  const handleRefreshPersonas = async () => {
    setProfileIndexing('personas');
    setStatus('Refreshing personas from profile...');
    try {
      const res = await window.electronAPI.refreshPersonasIndex({ maxItems: 500 });
      if (res.cancelled) setStatus('Personas refresh cancelled');
      else setStatus(`Loaded ${res.entries.length} personas`);
      setPersonasIndex(res.entries || []);
    } finally {
      setProfileIndexing(null);
    }
  };

  const handleRefreshVoices = async () => {
    setProfileIndexing('voices');
    setStatus('Refreshing voices from profile...');
    try {
      const res = await window.electronAPI.refreshVoicesIndex({ maxItems: 500 });
      if (res.cancelled) setStatus('Voices refresh cancelled');
      else setStatus(`Loaded ${res.entries.length} voices`);
      setVoicesIndex(res.entries || []);
    } finally {
      setProfileIndexing(null);
    }
  };

  const handleCancelProfileIndex = async () => {
    await window.electronAPI.cancelProfileIndex();
    setProfileIndexing(null);
    setStatus('Profile indexing cancelled');
  };

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-100), msg]);

  const refreshSettings = async () => {
    const res = await window.electronAPI.getSettings();
    setSettings(res);
    if (res?.userProfile) setUserProfile(res.userProfile as ViewerProfile);
  };

  const refreshExportIndex = async () => {
    setLoadingIndex(true);
    try {
      const record = await window.electronAPI.getExportIndex();
      setExportEntries(record?.exports || []);
    } finally {
      setLoadingIndex(false);
    }
  };

  const handleLaunch = async () => {
    setStatus("Launching Browser...");
    await window.electronAPI.launchBrowser();
    setStatus("Browser Open. Log in manually.");
  };

  const handleFetch = async () => {
    setStatus("Scanning Sidebar...");
    const updated = await window.electronAPI.refreshSidebarScan();
    setSession(updated);
    setUserProfile(updated?.viewer || null);
    const chats = await window.electronAPI.getChatsIndex();
    setChatsIndex(chats);
    setStatus(`Found ${chats.length} chats.`);
  };

  const handleRefreshViewer = async () => {
    setStatus("Refreshing viewer profile...");
    const res = await window.electronAPI.refreshViewerProfile();
    if (res?.session) setSession(res.session);
    setUserProfile(res?.profile || null);
    setStatus(res?.profile ? `Viewer updated: ${res.profile.displayName}` : "Viewer refresh complete");
  };

  const handleRefreshCreators = async () => {
    const isValidHandle = (h: string) => /^@[A-Za-z0-9_]{2,32}$/.test(h);
    const names = Array.from(
      new Set(
        (session?.characters || [])
          .map((c) => (c.creator?.handle || '').trim())
          .filter(Boolean)
          .filter(isValidHandle)
      )
    );
    if (names.length === 0) {
      setStatus('No creators to refresh');
      return;
    }
    setStatus(`Refreshing ${names.length} creators...`);
    const res = await window.electronAPI.refreshCreatorProfiles(names);
    if (res?.session) setSession(res.session);
    if (res?.session?.creators) setCreatorsIndex(res.session.creators as any);
    if (res?.message) {
      setStatus(res.message);
    } else {
      setStatus(`Creators refreshed (${res?.updated || 0} updated)`);
    }
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

  const handleHydrate = async () => {
    if (!chatsIndex.length) {
      setStatus('No chats to hydrate');
      return;
    }
    setHydrating(true);
    setHydrateProgress({ completed: 0, total: chatsIndex.length });
    setStatus('Hydrating creators/metadata...');
    const urls = chatsIndex.map((c) => c.chatUrl);
    const res = await window.electronAPI.hydrateChatsMetadata(urls, 25);
    if (res.cancelled) {
      setStatus('Hydration cancelled');
    } else {
      setStatus(`Hydration done (${res.metadata.length})`);
    }
    setHydrating(false);
  };

  const handleCancelHydrate = async () => {
    await window.electronAPI.cancelHydrate();
    setHydrating(false);
    setStatus('Hydration cancelled');
  };

  const handleRefreshProfileChars = async () => {
    setStatus('Refreshing characters from profile...');
    const res = await window.electronAPI.refreshCharactersFromProfile('most_chats');
    setCharactersIndex(res || []);
    setStatus(`Loaded ${res?.length || 0} characters from profile`);
  };

  const handleExport = async (chat: CharacterCardData) => {
    setBusy(true);
    setStatus("Exporting...");
    addLog(`Starting export for ${chat.name}...`);
    try {
      const res = await window.electronAPI.exportChat(chat.url || '', chat.name, reverseTranscript, chat.avatarUrl);
      addLog(`Exported ${res.count} messages to ${res.path}`);

      if (res.analysisSkipped || res.count === 0) {
        addLog(res.warning || "Export produced 0 messages; skipping analysis. Run 'Test selectors' to debug extraction.");
      } else {
        addLog("Running Python Analysis...");
        await window.electronAPI.runAnalysis(res.path);
      }
      await refreshExportIndex();
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
    }
    setBusy(false);
    setStatus("Ready");
  };

  const handleExportChatIndex = async (entry: ChatIndexEntry) => {
    const card: CharacterCardData = {
      id: entry.chatId,
      name: entry.characterName || 'Chat',
      creator: '',
      lastChat: entry.lastSeenLabel || '',
      url: entry.chatUrl,
      avatarUrl: entry.avatarUrl || undefined,
    };
    await handleExport(card);
  };

  const viewerUpdatedAt = session?.freshness?.sections?.viewer || null;
  const personasUpdatedAt = session?.freshness?.sections?.personas || null;
  const voicesUpdatedAt = session?.freshness?.sections?.voices || null;

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

  const handleViewChat = (chat: CharacterCardData) => {
    setActiveChat(chat);
    setViewerMessages([]); // real transcript wiring to be added
    if (chat.id && chat.id !== 'mock-1') {
      setViewTab('chats');
      setSelectedChatId(chat.id);
    }
  };

  const selectedChatMeta = useMemo(() => {
    if (!selectedChatId) return null;
    return (chatsIndex || []).find((c) => c.chatId === selectedChatId) || null;
  }, [selectedChatId, chatsIndex]);

  const loadExportArtifacts = async (exp: ExportIndexEntry) => {
    setSelectedExport(exp);
    setTranscriptError(null);
    setLoadingTranscript(true);
    try {
      if (exp.summaryPath) {
        const md = await window.electronAPI.readSummary(exp.summaryPath);
        setSelectedSummary(md || '');
      } else {
        setSelectedSummary('');
      }
  const tr = await window.electronAPI.readTranscript(exp.transcriptPath, transcriptMaxLines);
  setSelectedTranscript(tr.messages || []);
  setTranscriptWarnings(tr.warnings || []);
  setTranscriptTruncated((tr.warnings || []).some((w) => w.includes('Showing last')));
  const insights = await window.electronAPI.computeInsightsFromTranscript(tr.transcriptPath, transcriptMaxLines);
      setSelectedInsights(insights);
    } catch (e: any) {
      setTranscriptError(e?.message || String(e));
      setSelectedTranscript([]);
      setSelectedInsights(null);
      setSelectedSummary('');
      setTranscriptWarnings([]);
      setTranscriptTruncated(false);
    } finally {
      setLoadingTranscript(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedChatId) {
        setChatExports([]);
        setSelectedExport(null);
        setSelectedTranscript(null);
        setSelectedInsights(null);
        setSelectedSummary('');
        setTranscriptWarnings([]);
        setTranscriptTruncated(false);
        setTranscriptError(null);
        return;
      }
      setTranscriptError(null);
      setLoadingTranscript(true);
      try {
        const exportsForChat = await window.electronAPI.listExportsForChat(selectedChatId);
        if (cancelled) return;
        setChatExports(exportsForChat);
        if (exportsForChat.length === 0) {
          setSelectedExport(null);
          setSelectedTranscript([]);
          setSelectedInsights(null);
          setSelectedSummary('');
          setTranscriptWarnings([]);
          setTranscriptTruncated(false);
          return;
        }
        await loadExportArtifacts(exportsForChat[0]);
      } catch (e: any) {
        if (cancelled) return;
        setTranscriptError(e?.message || String(e));
        setChatExports([]);
        setSelectedExport(null);
        setSelectedTranscript([]);
        setSelectedInsights(null);
        setSelectedSummary('');
        setTranscriptWarnings([]);
        setTranscriptTruncated(false);
      } finally {
        if (!cancelled) setLoadingTranscript(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, transcriptMaxLines]);

  const formatTimestamp = (iso?: string | null) => {
    if (!iso) return 'never';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'unknown';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleString();
  };

  const characterCards: CharacterCardData[] = useMemo(() => {
    const chars = charactersIndex.length ? charactersIndex : (session?.characters || []);
    if (!chars || chars.length === 0) {
      return [
        { id: 'mock-1', name: 'No scans yet', creator: 'Run Scan Sidebar', interactions: undefined, lastChat: '—', url: '#' },
      ];
    }
    return chars.map((c, idx) => {
      const fromProfileIndex = 'profileUrl' in (c as any);
      if (fromProfileIndex) {
        const ci = c as CharacterIndexEntry;
        const creatorHandle = ci.creatorHandle || 'Unknown';
        const creatorKey = creatorHandle !== 'Unknown' ? creatorHandle.replace(/^@/, '') : null;
        const creatorProfile = creatorKey ? (creatorsIndex as any)?.[creatorKey] : undefined;
        return {
          id: ci.characterId || `char-${idx}`,
          name: ci.name || 'Character',
          creator: creatorHandle,
          creatorAvatarUrl: creatorProfile?.avatarUrl || ci.avatarUrl || null,
          interactions: ci.interactions || undefined,
          lastChat: ci.tagline || 'Recently',
          avatarUrl: ci.avatarUrl || undefined,
          url: ci.profileUrl,
        };
      }
      const cs = c as any;
      const creatorHandle = cs.creator?.handle || 'Unknown';
      const creatorKey = creatorHandle !== 'Unknown' ? creatorHandle.replace(/^@/, '') : null;
      const creatorProfile = creatorKey ? (creatorsIndex as any)?.[creatorKey] : undefined;
      return {
        id: cs.chatId || cs.characterId || `char-${idx}`,
        name: cs.displayName || 'Character',
        creator: creatorHandle,
        creatorAvatarUrl: creatorProfile?.avatarUrl || cs.creator?.avatarUrl || null,
        interactions: cs.interactions || undefined,
        lastChat: cs.lastSeenLabel || cs.preview || 'Recently',
        avatarUrl: cs.avatarUrl || undefined,
        url: cs.url,
      };
    });
  }, [session, charactersIndex, creatorsIndex]);

  const sortedChats = useMemo(() => {
    const list = [...(chatsIndex || [])];
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [chatsIndex]);

  const charactersUpdatedAt = session?.freshness?.sections?.characters || session?.freshness?.lastUpdated;
  // timestamps live near sidebar + tab headers

  const isStale = (iso?: string | null, minutes = 360) => {
    if (!iso) return true;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return true;
    const diff = Date.now() - date.getTime();
    return diff > minutes * 60 * 1000;
  };

  const handleChooseExportRoot = async () => {
    const updated = await window.electronAPI.chooseExportRoot();
    setSettings(updated);
    addLog(`Export root set to ${updated.exportRootPath}`);
  };

  const handleResetProfile = async () => {
    const res = await window.electronAPI.resetBrowserProfile();
    setProfileDir(res.profileDir);
    addLog(`Browser profile reset at ${res.profileDir}`);
    setUserProfile(null);
    const snapshot = await window.electronAPI.getSession();
    setSession(snapshot);
  };

  const handleRemoveExport = async (id: string) => {
    const res = await window.electronAPI.removeExportEntry(id);
    setExportEntries(res.exports || []);
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <AccountSidebar
        active={viewTab}
        profile={userProfile}
        viewerUpdatedAt={viewerUpdatedAt}
        onNavigate={(section) => {
          if (section === 'characters' || section === 'personas' || section === 'voices' || section === 'chats') {
            setViewTab(section);
          }
        }}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-gray-900 bg-gray-950/80 backdrop-blur px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="text-amber-400" />
            <div>
              <div className="text-sm text-gray-400">Status</div>
              <div className="font-semibold text-gray-100">{status}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={handleLaunch} className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-500 text-sm flex items-center gap-2 disabled:opacity-50">
              <Play size={16} /> Launch
            </button>
            <button disabled={busy} onClick={handleFetch} className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-500 text-sm flex items-center gap-2 disabled:opacity-50">
              <FolderOpen size={16} /> Scan Sidebar
            </button>
            <button disabled={busy} onClick={handleRefreshViewer} className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-500 text-sm flex items-center gap-2 disabled:opacity-50">
              <RefreshCw size={16} /> Refresh Viewer
            </button>
            <button disabled={busy} onClick={handleRefreshCreators} className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-500 text-sm flex items-center gap-2 disabled:opacity-50">
              <RefreshCw size={16} /> Refresh Creators
            </button>
            <button disabled={busy} onClick={handleTestSelectors} className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-500 text-sm flex items-center gap-2 disabled:opacity-50">
              <Terminal size={16} /> Test Selectors
            </button>
            <button
              onClick={() => setReverseTranscript((v) => !v)}
              className={`px-3 py-2 rounded-lg border text-sm ${reverseTranscript ? 'border-amber-500 text-amber-200' : 'border-gray-800 text-gray-300 hover:border-amber-500'}`}
            >
              Reverse order
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2 p-4 border border-gray-900 rounded-xl bg-gray-900/40">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">AI Draft Helper</div>
              <div className="flex flex-wrap gap-3 items-center">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('gemini_key', e.target.value); }}
                  placeholder="Gemini API key (optional)"
                  className="flex-1 min-w-[200px] bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={handleDraft}
                  className="px-3 py-2 rounded-lg bg-purple-900/40 border border-purple-700 hover:border-purple-400 text-sm flex items-center gap-2 text-purple-100"
                >
                  <BrainCircuit size={16} /> Draft suggestions
                </button>
              </div>
            </div>
            <div className="p-4 border border-gray-900 rounded-xl bg-gray-900/40 text-sm text-gray-400 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">Export root</div>
                  <div className="text-gray-200 text-sm truncate max-w-[220px]">{settings?.exportRootPath || 'Loading...'}</div>
                </div>
                <button onClick={handleChooseExportRoot} className="px-2 py-1 rounded border border-gray-800 hover:border-amber-500 text-xs">Change</button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">Browser profile</div>
                  <div className="text-gray-200 text-sm truncate max-w-[220px]">{profileDir || 'Loading...'}</div>
                </div>
                <button onClick={handleResetProfile} className="px-2 py-1 rounded border border-gray-800 hover:border-amber-500 text-xs">Reset session</button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">Viewer</div>
                  <div className="text-gray-200 text-sm truncate max-w-[220px]">{userProfile?.displayName || 'Not loaded'}</div>
                </div>
                <div className={`text-[11px] px-2 py-1 rounded border ${isStale(viewerUpdatedAt, 180) ? 'border-amber-500 text-amber-300' : 'border-gray-800 text-gray-400'}`}>
                  Updated {formatTimestamp(viewerUpdatedAt)}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">Characters</div>
                  <div className="text-gray-200 text-sm truncate max-w-[220px]">{session?.characters?.length || 0} cached</div>
                </div>
                <div className={`text-[11px] px-2 py-1 rounded border ${isStale(charactersUpdatedAt, 180) ? 'border-amber-500 text-amber-300' : 'border-gray-800 text-gray-400'}`}>
                  Updated {formatTimestamp(charactersUpdatedAt)}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={!!settings?.verboseLogs} onChange={async (e) => {
                  const updated = await window.electronAPI.saveSettings({ verboseLogs: e.target.checked });
                  setSettings(updated);
                }} />
                Verbose logs (UI)
              </label>
              <div className="text-xs text-gray-400 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${reverseTranscript ? 'bg-amber-400' : 'bg-gray-600'}`} />
                <span>Transcript order: {reverseTranscript ? 'Newest first' : 'Oldest first'}</span>
              </div>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Library</div>
                <div className="text-lg font-semibold text-gray-100">
                  {viewTab === 'characters' ? 'Characters' : viewTab === 'personas' ? 'Personas' : viewTab === 'voices' ? 'Voices' : 'Chats'} index
                </div>
                <div className={`text-xs ${isStale(viewTab === 'personas' ? personasUpdatedAt : viewTab === 'voices' ? voicesUpdatedAt : charactersUpdatedAt, 180) ? 'text-amber-300' : 'text-gray-500'}`}>
                  Updated {formatTimestamp(viewTab === 'personas' ? personasUpdatedAt : viewTab === 'voices' ? voicesUpdatedAt : charactersUpdatedAt)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <div className="border border-gray-800 rounded-lg overflow-hidden flex">
                  <button className={`px-3 py-1 ${viewTab === 'characters' ? 'bg-gray-800 text-amber-200' : 'text-gray-400'}`} onClick={() => setViewTab('characters')}>Characters</button>
                  <button className={`px-3 py-1 ${viewTab === 'personas' ? 'bg-gray-800 text-amber-200' : 'text-gray-400'}`} onClick={() => setViewTab('personas')}>Personas</button>
                  <button className={`px-3 py-1 ${viewTab === 'voices' ? 'bg-gray-800 text-amber-200' : 'text-gray-400'}`} onClick={() => setViewTab('voices')}>Voices</button>
                  <button className={`px-3 py-1 ${viewTab === 'chats' ? 'bg-gray-800 text-amber-200' : 'text-gray-400'}`} onClick={() => setViewTab('chats')}>Chats</button>
                </div>
                {viewTab === 'characters' ? (
                  <div className="flex items-center gap-2">
                    <button onClick={handleRefreshProfileChars} className="px-3 py-2 rounded-lg border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1">
                      <RefreshCw size={12}/> Profile chars
                    </button>
                    <div className="text-[11px] text-gray-500">Profile index: {charactersIndex.length} · Sidebar cache: {session?.characters?.length || 0}</div>
                  </div>
                ) : viewTab === 'personas' ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRefreshPersonas}
                      disabled={profileIndexing !== null}
                      className="px-3 py-2 rounded-lg border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw size={12}/> Refresh personas
                    </button>
                    {profileIndexing === 'personas' && (
                      <button onClick={handleCancelProfileIndex} className="px-3 py-2 rounded-lg border border-red-700 text-xs text-red-300 hover:border-red-400">
                        Cancel
                      </button>
                    )}
                    <div className="text-[11px] text-gray-500">{personasIndex.length} cached</div>
                  </div>
                ) : viewTab === 'voices' ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRefreshVoices}
                      disabled={profileIndexing !== null}
                      className="px-3 py-2 rounded-lg border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw size={12}/> Refresh voices
                    </button>
                    {profileIndexing === 'voices' && (
                      <button onClick={handleCancelProfileIndex} className="px-3 py-2 rounded-lg border border-red-700 text-xs text-red-300 hover:border-red-400">
                        Cancel
                      </button>
                    )}
                    <div className="text-[11px] text-gray-500">{voicesIndex.length} cached</div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={handleHydrate} disabled={hydrating} className="px-3 py-2 rounded-lg border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1 disabled:opacity-50">
                      <RefreshCw size={12}/> Hydrate metadata
                    </button>
                    {hydrating && (
                      <button onClick={handleCancelHydrate} className="px-3 py-2 rounded-lg border border-red-700 text-xs text-red-300 hover:border-red-400">
                        Cancel
                      </button>
                    )}
                    <div className="text-[11px] text-gray-500">
                      {hydrating ? `Hydrating ${hydrateProgress.completed || 0}/${hydrateProgress.total || chatsIndex.length}` : `${chatsIndex.length} chats indexed`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {viewTab === 'characters' ? (
              <CharacterGrid
                items={characterCards}
                onExport={handleExport}
                onView={(c) => {
                  handleViewChat(c);
                }}
              />
            ) : viewTab === 'personas' ? (
              <div className="border border-gray-900 rounded-xl bg-gray-900/40 divide-y divide-gray-900">
                {personasIndex.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No personas cached yet. Click “Refresh personas”.</div>
                ) : (
                  personasIndex.map((p) => (
                    <div key={p.id} className="p-3 flex items-center gap-3">
                      {p.avatarUrl ? (
                        <img src={p.avatarUrl} className="w-9 h-9 rounded-full object-cover border border-gray-800" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-800" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm text-gray-100 font-semibold truncate">{p.displayName}</div>
                        <div className="text-xs text-gray-500 truncate">{p.description || '—'}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : viewTab === 'voices' ? (
              <div className="border border-gray-900 rounded-xl bg-gray-900/40 divide-y divide-gray-900">
                {voicesIndex.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No voices cached yet. Click “Refresh voices”.</div>
                ) : (
                  voicesIndex.map((v) => (
                    <div key={v.id} className="p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-xs text-gray-300">Voice</div>
                      <div className="min-w-0">
                        <div className="text-sm text-gray-100 font-semibold truncate">{v.displayName}</div>
                        <div className="text-xs text-gray-500 truncate">{v.description || '—'}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="border border-gray-900 rounded-xl bg-gray-900/40 divide-y divide-gray-900">
                {sortedChats.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No chats indexed yet. Run Scan Sidebar.</div>
                ) : (
                  sortedChats.map((c) => (
                    <div
                      key={c.chatId}
                      className={`p-3 grid md:grid-cols-6 gap-2 items-center text-sm cursor-pointer ${selectedChatId === c.chatId ? 'bg-amber-500/10' : ''}`}
                      onClick={() => setSelectedChatId(c.chatId)}
                    >
                      <div className="md:col-span-2 min-w-0">
                        <div className="text-gray-100 font-semibold truncate">{c.characterName || 'Unknown chat'}</div>
                        <div className="text-[11px] text-gray-500 truncate">{c.chatId}</div>
                      </div>
                      <div className="text-gray-400 text-xs">{c.lastSeenLabel || '—'}</div>
                      <div className="text-gray-400 text-xs">{formatTimestamp(c.updatedAt)}</div>
                      <div className="text-gray-500 text-xs truncate">{c.chatUrl}</div>
                      <div className="flex flex-wrap gap-2 justify-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportChatIndex(c);
                          }}
                          className="px-3 py-1 rounded-lg border border-gray-800 hover:border-amber-500 text-xs"
                        >
                          Export
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Recent exports</div>
                <div className="text-lg font-semibold text-gray-100">Persisted archive</div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {loadingIndex ? 'Refreshing…' : `${exportEntries.length} exports`}
                <button onClick={refreshExportIndex} className="px-2 py-1 rounded border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1">
                  <RefreshIcon size={12} /> Refresh
                </button>
              </div>
            </div>
            {exportEntries.length === 0 ? (
              <div className="text-sm text-gray-500 border border-dashed border-gray-800 rounded-lg p-4">No exports yet. Run an export to populate the archive.</div>
            ) : (
              <div className="space-y-2">
                {exportEntries.map((e) => (
                  <div key={e.id} className="border border-gray-900 rounded-xl p-4 bg-gray-900/40 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-gray-100 font-semibold truncate">{e.characterName}</div>
                        {e.broken && <span className="text-amber-400 text-xs inline-flex items-center gap-1"><AlertTriangle size={12}/>Broken ({e.broken.join(', ')})</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">Chat ID: {e.chatId}</div>
                      <div className="text-xs text-gray-400">Exported: {new Date(e.exportedAt).toLocaleString()} · {e.messageCount} messages</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => window.electronAPI.openFolder(e.exportDirAbsolutePath)} className="px-3 py-2 rounded-lg border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1">
                        <Folder size={14}/> Open folder
                      </button>
                      <button onClick={() => handleRemoveExport(e.id)} className="px-3 py-2 rounded-lg border border-gray-900 hover:border-red-500 text-xs flex items-center gap-1 text-red-300">
                        <Trash2 size={14}/> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid lg:grid-cols-3 gap-4 min-h-[320px]">
            <div className="lg:col-span-2 flex flex-col min-h-[320px]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                <div className="flex items-center gap-2">
                  <div className="text-gray-200 font-semibold">Selected chat</div>
                  <div className="text-gray-500">{selectedChatMeta?.characterName || activeChat?.name || '—'}</div>
                  {selectedChatId && <div className="text-gray-600">({selectedChatId})</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                    placeholder="Search transcript"
                    className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs min-w-[220px]"
                  />
                  {selectedChatId && (
                    <select
                      value={selectedExport?.id || ''}
                      onChange={(e) => {
                        const next = chatExports.find((x) => x.id === e.target.value);
                        if (next) loadExportArtifacts(next);
                      }}
                      className="bg-gray-950 border border-gray-800 rounded-lg px-2 py-2 text-xs"
                    >
                      <option value="" disabled>Export snapshot…</option>
                      {(chatExports || []).map((e) => (
                        <option key={e.id} value={e.id}>{new Date(e.exportedAt).toLocaleString()}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {selectedChatId && chatExports.length === 0 ? (
                <div className="flex-1 bg-gray-950 border border-gray-900 rounded-2xl p-6 text-sm text-gray-400">
                  <div className="text-gray-200 font-semibold mb-2">No export yet</div>
                  <div className="mb-4">Export this chat to view transcripts locally.</div>
                  <button
                    onClick={async () => {
                      const meta = selectedChatMeta;
                      if (!meta?.chatUrl) return;
                      await handleExportChatIndex(meta);
                      const exportsForChat = await window.electronAPI.listExportsForChat(meta.chatId);
                      setChatExports(exportsForChat);
                      if (exportsForChat.length) await loadExportArtifacts(exportsForChat[0]);
                    }}
                    className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-amber-500 text-sm"
                  >
                    Export this chat
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {transcriptTruncated && selectedExport?.transcriptPath && (
                    <div className="mb-2 text-xs border border-amber-500/30 bg-amber-500/10 rounded-xl p-3 text-amber-200 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        Showing last {transcriptMaxLines.toLocaleString()} messages. Load older to expand history.
                        {transcriptWarnings.length ? <span className="text-amber-300"> {' '}({transcriptWarnings[0]})</span> : null}
                      </div>
                      <button
                        disabled={loadingTranscript}
                        onClick={async () => {
                          if (!selectedExport?.transcriptPath) return;
                          setLoadingTranscript(true);
                          try {
                            const res = await window.electronAPI.readTranscriptPage(selectedExport.transcriptPath, {
                              direction: 'older',
                              pageSize: 25_000,
                              currentMaxLines: transcriptMaxLines,
                            });
                            setTranscriptMaxLines(res.maxLines);
                            setSelectedTranscript(res.messages || []);
                            setTranscriptWarnings(res.warnings || []);
                            setTranscriptTruncated(res.truncated);
                            const insights = await window.electronAPI.computeInsightsFromTranscript(res.transcriptPath, res.maxLines);
                            setSelectedInsights(insights);
                          } catch (e: any) {
                            setTranscriptError(e?.message || String(e));
                          } finally {
                            setLoadingTranscript(false);
                          }
                        }}
                        className="px-3 py-2 rounded-lg border border-amber-500/40 hover:border-amber-400 text-xs disabled:opacity-50"
                      >
                        Load older
                      </button>
                    </div>
                  )}
                  <ChatViewerPanel
                    messages={selectedTranscript || []}
                    characterName={selectedChatMeta?.characterName || activeChat?.name || 'Transcript'}
                    reverse={reverseTranscript}
                    search={transcriptSearch}
                    loading={loadingTranscript}
                    error={transcriptError}
                    exportDir={selectedExport?.exportDirAbsolutePath || null}
                    transcriptPath={selectedExport?.transcriptPath || null}
                    summaryPath={selectedExport?.summaryPath || null}
                    onOpenFolder={() => selectedExport?.exportDirAbsolutePath && window.electronAPI.openPathInExplorer(selectedExport.exportDirAbsolutePath)}
                    onOpenTranscript={() => selectedExport?.transcriptPath && window.electronAPI.openFile(selectedExport.transcriptPath)}
                    onOpenSummary={() => selectedExport?.summaryPath && window.electronAPI.openFile(selectedExport.summaryPath)}
                  />
                </div>
              )}
            </div>
            <InsightsPanel insights={selectedInsights} summaryMarkdown={selectedSummary || ''} />
          </section>

          <section>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
              <RefreshCw size={14} className="text-amber-400" />
              System Logs
            </div>
            <div className="h-56 bg-black border border-gray-900 rounded-xl p-3 font-mono text-xs overflow-y-auto text-green-400">
              {logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </section>
        </div>
      </main>

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