
import React, { useState, useEffect, useMemo } from 'react';
import { Play, FolderOpen, RefreshCw, Archive, BarChart2, Download, AlertTriangle, X, Loader2, StopCircle, MessageSquare, Users, Mic2, FileText, Columns, ArrowLeft, Globe, Snowflake } from 'lucide-react';
import AccountSidebar from './components/AccountSidebar';
import ChatList from './components/ChatList';
import CharacterGrid from './components/CharacterGrid';
import ChatViewerPanel from './components/ChatViewerPanel';
import InsightsPanel from './components/InsightsPanel';
import SettingsPanel from './components/SettingsPanel';
import SnowOverlay from './components/effects/SnowOverlay';
import { ExportIndexEntry, SessionSnapshot, ViewerProfile, ChatIndexEntry, CharacterIndexEntry, TranscriptMessage, TranscriptInsights, CharacterCardData } from '../types';

const LogsModal = ({ isOpen, onClose, logs }: { isOpen: boolean; onClose: () => void; logs: string[] }) => {
    if (!isOpen) return null;
    
    const handleSave = async () => {
        try {
            const result = await window.electronAPI.saveLogs(logs);
            if (result.success) {
                alert(`Logs saved to ${result.path}`);
            } else if (result.error !== 'Cancelled') {
                alert(`Failed to save logs: ${result.error}`);
            }
        } catch (e) {
            console.error(e);
            alert('Error saving logs');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[#18181b] border border-white/10 rounded-xl w-full max-w-2xl h-[60vh] flex flex-col shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                    <h3 className="font-medium text-white">Application Logs</h3>
                    <div className="flex gap-2">
                        <button onClick={handleSave} className="p-1 text-zinc-400 hover:text-white" title="Save to File">
                            <Download size={20} />
                        </button>
                        <button onClick={onClose}><X size={20} className="text-zinc-400 hover:text-white" /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-zinc-400 space-y-1">
                    {logs.map((log, i) => (
                        <div key={i} className="border-b border-white/5 pb-1 mb-1 last:border-0">{log}</div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default function App() {
  // --- Global State ---
  const [logs, setLogs] = useState<string[]>([]);
  const [jobStatus, setJobStatus] = useState<{ busy: boolean, current: { type: string, id: string } | null }>({ busy: false, current: null });
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [userProfile, setUserProfile] = useState<ViewerProfile | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  
  // --- Data Indices ---
  const [chatsIndex, setChatsIndex] = useState<ChatIndexEntry[]>([]);
  const [charactersIndex, setCharactersIndex] = useState<CharacterIndexEntry[]>([]);
  const [exportEntries, setExportEntries] = useState<ExportIndexEntry[]>([]);

  // --- View State ---
  const [viewTab, setViewTab] = useState<'characters' | 'personas' | 'voices' | 'chats' | 'settings' | 'browser'>('browser'); // Default to browser
  const [globalSearch, setGlobalSearch] = useState('');
  const browserContainerRef = React.useRef<HTMLDivElement>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [splitPanelContent, setSplitPanelContent] = useState<'characters' | 'chats' | 'personas' | 'voices'>('characters');
  const [panelPosition, setPanelPosition] = useState<'left' | 'right'>('right');
  const [isDetached, setIsDetached] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [isSnowing, setIsSnowing] = useState(false);

  // --- BrowserView Management ---
  useEffect(() => {
    // Sync snow state
    window.electronAPI.toggleSnow(isSnowing);
  }, [isSnowing]);
  useEffect(() => {
    // Browser is active unless we are in Settings, Detached, or Offline Mode
    const isBrowserActive = viewTab !== 'settings' && !isDetached && !isOfflineMode;
    
    if (isBrowserActive && !showLogs) {
        const updateBounds = () => {
            if (browserContainerRef.current) {
                const rect = browserContainerRef.current.getBoundingClientRect();
                // Ensure we don't send invalid rects
                if (rect.width > 0 && rect.height > 0) {
                    // Safety: Ensure the browser view doesn't cover the header (64px)
                    // If rect.y is 0, it means the layout hasn't pushed the container down yet,
                    // or the header is missing. We enforce a minimum Y to keep the header visible.
                    const safeY = Math.max(rect.y, 64);
                    const safeHeight = rect.height - (safeY - rect.y);

                    window.electronAPI.showBrowserView({
                        x: Math.round(rect.x),
                        y: Math.round(safeY),
                        width: Math.round(rect.width),
                        height: Math.round(safeHeight)
                    });
                }
            }
        };
        
        // Initial update - increased delay to ensure layout stability
        const timer = setTimeout(updateBounds, 300); 
        window.addEventListener('resize', updateBounds);
        const interval = setInterval(updateBounds, 500); // Periodic check
        
        return () => {
            window.removeEventListener('resize', updateBounds);
            clearInterval(interval);
            clearTimeout(timer);
            // Only hide if we are actually leaving the browser context (e.g. to settings)
            // But here we can't know the next state easily in cleanup.
            // The next effect run will handle hiding if needed.
        };
    } else {
        window.electronAPI.hideBrowserView();
    }
  }, [viewTab, isSplitView, panelPosition, showLogs, isDetached, isOfflineMode]);
  
  // --- Chat View State ---
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptMessage[]>([]);
  const [selectedInsights, setSelectedInsights] = useState<TranscriptInsights | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');

  // --- Initialization ---
  useEffect(() => {
    // Event Listeners
    // Remove slice limit to show full history in UI
    window.electronAPI.onScraperLog((msg) => setLogs(p => [...p, msg]));
    window.electronAPI.onAnalysisLog((msg) => setLogs(p => [...p, `[Analysis] ${msg}`]));
    window.electronAPI.onSessionUpdated((s) => { setSession(s); setUserProfile(s.viewer); });
    window.electronAPI.onExportIndexUpdate((idx) => setExportEntries(idx.exports || []));
    window.electronAPI.onCharactersIndexUpdate(setCharactersIndex);
    window.electronAPI.onJobStatus(setJobStatus);
    window.electronAPI.onBrowserDetachedClosed(() => setIsDetached(false));

    // Initial Data Fetch
    const load = async () => {
        try {
          const s = await window.electronAPI.getSession();
          setSession(s);
          setUserProfile(s?.viewer || null);
          setChatsIndex(await window.electronAPI.getChatsIndex());
          setCharactersIndex(await window.electronAPI.getCharactersIndex());
          setExportEntries((await window.electronAPI.getExportIndex()).exports || []);
        } catch (e: any) {
          setAppError(`Initialization failed: ${e.message}`);
        }
    };
    load();
  }, []);

  // --- Actions ---
  const handleLaunch = () => window.electronAPI.launchBrowser().catch(e => setAppError(e.message));
  
  const handleScan = async () => {
    try {
      const res = await window.electronAPI.refreshSidebarScan();
      setChatsIndex(res.chats);
      setUserProfile(res.viewer || userProfile);
    } catch (e: any) {
      setAppError(`Scan failed: ${e.message}`);
    }
  };
  
  const handleCancelJob = () => window.electronAPI.cancelJob();
  const handleDiagnostics = () => window.electronAPI.exportDiagnostics();
  const handleChooseFolder = () => window.electronAPI.chooseExportRoot();
  const handleOpenExportFolder = () => window.electronAPI.openFolder(exportEntries[0]?.exportDirAbsolutePath ? exportEntries[0].exportDirAbsolutePath + "/.." : ".");

  const handleExport = async (chatId: string) => {
    const chat = chatsIndex.find(c => c.chatId === chatId);
    if (!chat) return;
    try {
        await window.electronAPI.exportChat(chat.chatUrl, chat.characterName || 'Unknown');
        // Refresh export entries
        const idx = await window.electronAPI.getExportIndex();
        setExportEntries(idx.exports);
    } catch (e: any) {
        setAppError(`Export failed: ${e.message}`);
    }
  };

  // --- Derived Data ---
  const activeChatMeta = useMemo(() => chatsIndex.find(c => c.chatId === activeChatId), [chatsIndex, activeChatId]);
  const activeExport = useMemo(() => exportEntries.find(e => e.chatId === activeChatId), [exportEntries, activeChatId]);

  // --- Transcript Loading ---
  useEffect(() => {
    if (!activeChatId) {
        setSelectedTranscript([]);
        setSelectedInsights(null);
        return;
    }
    
    // Only try to load if we have an export
    if (activeExport) {
        setLoadingTranscript(true);
        setTranscriptError(null);
        const fetchTranscript = async () => {
            try {
                const tr = await window.electronAPI.readTranscript(activeExport.transcriptPath, 50000);
                setSelectedTranscript(tr.messages || []);
                const ins = await window.electronAPI.computeInsightsFromTranscript(tr.transcriptPath);
                setSelectedInsights(ins);
            } catch (e: any) {
                setTranscriptError(e.message);
            } finally {
                setLoadingTranscript(false);
            }
        };
        fetchTranscript();
    } else {
        setSelectedTranscript([]);
        setTranscriptError(null);
    }
  }, [activeChatId, activeExport]);

  // --- Character Cards Prep ---
  const characterCards: CharacterCardData[] = useMemo(() => {
    // Combine session characters + index
    const source = charactersIndex.length > 0 ? charactersIndex : (session?.characters || []);
    return source.map((c: any, idx) => ({
        id: c.characterId || c.chatId || `char-${idx}`,
        name: c.name || c.displayName || 'Unknown',
        creator: c.creatorHandle || c.creator?.handle,
        avatarUrl: c.avatarUrl,
        interactions: c.interactions,
        likes: c.likes,
        url: c.profileUrl || c.url
    }));
  }, [charactersIndex, session]);

  const filteredCharacters = useMemo(() => {
    const q = globalSearch.toLowerCase();
    if (!q) return characterCards;
    return characterCards.filter(c => c.name.toLowerCase().includes(q));
  }, [characterCards, globalSearch]);

  // --- Action Button Helper ---
  const ActionButton = ({ icon: Icon, label, onClick, disabled = false, variant = 'secondary', alwaysEnabled = false }: any) => (
    <button 
      disabled={disabled || (!alwaysEnabled && jobStatus.busy && variant !== 'danger')} 
      onClick={onClick} 
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
        ${variant === 'primary' 
          ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20' 
          : variant === 'danger'
          ? 'bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-800/50'
          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/5'}
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div className="flex h-screen bg-[#09090b] text-gray-100 font-sans overflow-hidden select-none">
      <AccountSidebar 
        activeTab={viewTab === 'browser' && isSplitView ? splitPanelContent : viewTab} 
        onNavigate={(tab) => { 
            if (tab === 'settings') {
                setViewTab('settings');
            } else if (tab === 'browser') {
                setViewTab('browser');
                setIsSplitView(false);
            } else if (tab === 'characters' || tab === 'chats' || tab === 'personas' || tab === 'voices') {
                setViewTab('browser');
                setIsSplitView(true);
                setSplitPanelContent(tab);
            }
            setActiveChatId(null); 
        }} 
        profile={userProfile}
        globalSearch={globalSearch}
        onSearchChange={setGlobalSearch}
        isSnowing={isSnowing}
        onToggleSnow={() => setIsSnowing(p => !p)}
      />
      
      <SnowOverlay enabled={isSnowing} />
      
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Action Bar */}
        <header className="h-16 border-b border-white/5 bg-[#0d0d10] px-6 flex items-center justify-between flex-shrink-0 z-20">
          <div className="flex items-center gap-4">
            {/* Job Status Indicator */}
            {jobStatus.busy ? (
                <div className="flex items-center gap-3 px-3 py-1.5 bg-blue-900/10 text-blue-400 text-xs rounded-full border border-blue-900/30 animate-pulse">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="font-semibold">{jobStatus.current?.type || 'Processing'}...</span>
                    <span className="text-blue-500/60 max-w-[200px] truncate">{logs[logs.length-1]}</span>
                </div>
            ) : (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-2 h-2 rounded-full bg-green-500/50"></div>
                    Ready
                </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {jobStatus.busy && (
                <ActionButton icon={StopCircle} label="Cancel" onClick={handleCancelJob} variant="danger" />
            )}
            <div className="h-4 w-px bg-white/10 mx-1"></div>
            <ActionButton icon={FileText} label="Logs" onClick={() => setShowLogs(true)} alwaysEnabled={true} />
            
            {viewTab !== 'settings' && (
                <>
                    <ActionButton icon={RefreshCw} label="Sync Page" onClick={() => window.electronAPI.scrapeCurrentPage()} alwaysEnabled={true} />
                    
                    {!isOfflineMode && (
                        <ActionButton 
                            icon={Columns} 
                            label={isSplitView ? "Full View" : "Split View"} 
                            onClick={() => setIsSplitView(!isSplitView)} 
                            active={isSplitView}
                        />
                    )}
                    
                    {isSplitView && !isOfflineMode && (
                        <ActionButton 
                            icon={panelPosition === 'right' ? Columns : Columns} 
                            label={panelPosition === 'right' ? "Move Left" : "Move Right"}
                            onClick={() => setPanelPosition(p => p === 'right' ? 'left' : 'right')}
                        />
                    )}
                    <div className="h-4 w-px bg-white/10 mx-1"></div>
                    
                    <ActionButton 
                        icon={isOfflineMode ? Globe : Archive} 
                        label={isOfflineMode ? "Go Online" : "Offline Vault"} 
                        onClick={() => {
                            if (isOfflineMode) {
                                setIsOfflineMode(false);
                                setViewTab('browser');
                            } else {
                                setIsOfflineMode(true);
                                setIsSplitView(true); // Force split view content to show
                            }
                        }} 
                        active={isOfflineMode}
                        variant={isOfflineMode ? 'primary' : 'secondary'}
                    />

                    {!isOfflineMode && (
                        <>
                            <div className="h-4 w-px bg-white/10 mx-1"></div>
                            {isDetached ? (
                                <ActionButton 
                                    icon={Archive} 
                                    label="Attach" 
                                    onClick={async () => {
                                        await window.electronAPI.attachBrowser();
                                        setIsDetached(false);
                                    }} 
                                    variant="primary"
                                />
                            ) : (
                                <ActionButton 
                                    icon={Archive} 
                                    label="Detach" 
                                    onClick={async () => {
                                        await window.electronAPI.detachBrowser();
                                        setIsDetached(true);
                                    }} 
                                />
                            )}
                        </>
                    )}
                </>
            )}

            <ActionButton icon={FolderOpen} label="Scan" onClick={handleScan} />
            <ActionButton icon={Archive} label="Folder" onClick={handleChooseFolder} />
          </div>
        </header>

        <LogsModal isOpen={showLogs} onClose={() => setShowLogs(false)} logs={logs} />

        {/* Global Error Banner */}
        {appError && (
            <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 text-red-200 text-sm">
                    <AlertTriangle size={16} />
                    <span>{appError}</span>
                </div>
                <button onClick={() => setAppError(null)} className="text-red-400 hover:text-white">
                    <X size={16} />
                </button>
            </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden relative flex">
            {/* Browser Layer - Always rendered unless in Settings */}
            {viewTab !== 'settings' && (
                <>
                    {!isOfflineMode && (
                        <div ref={browserContainerRef} className={`flex-1 bg-black/20 ${panelPosition === 'left' ? 'order-2' : 'order-1'}`} />
                    )}
                    
                    {/* Split Panel Overlay/Sidebar */}
                    {(isSplitView || isOfflineMode) && (
                        <div className={`${isOfflineMode ? 'w-full' : 'w-[450px]'} bg-[#0d0d10] flex flex-col z-10 ${!isOfflineMode && (panelPosition === 'left' ? 'order-1 border-r border-white/5' : 'order-2 border-l border-white/5')}`}>
                            <div className="h-10 border-b border-white/5 flex items-center px-4 gap-4 bg-[#121214]">
                                <button 
                                    onClick={() => { setSplitPanelContent('characters'); setActiveChatId(null); }}
                                    className={`text-xs font-medium pb-1 border-b-2 transition-colors ${splitPanelContent === 'characters' ? 'text-white border-blue-500' : 'text-zinc-500 border-transparent'}`}
                                >
                                    Characters
                                </button>
                                <button 
                                    onClick={() => { setSplitPanelContent('chats'); setActiveChatId(null); }}
                                    className={`text-xs font-medium pb-1 border-b-2 transition-colors ${splitPanelContent === 'chats' ? 'text-white border-blue-500' : 'text-zinc-500 border-transparent'}`}
                                >
                                    Chats
                                </button>
                                <button 
                                    onClick={() => { setSplitPanelContent('personas'); setActiveChatId(null); }}
                                    className={`text-xs font-medium pb-1 border-b-2 transition-colors ${splitPanelContent === 'personas' ? 'text-white border-blue-500' : 'text-zinc-500 border-transparent'}`}
                                >
                                    Personas
                                </button>
                                <button 
                                    onClick={() => { setSplitPanelContent('voices'); setActiveChatId(null); }}
                                    className={`text-xs font-medium pb-1 border-b-2 transition-colors ${splitPanelContent === 'voices' ? 'text-white border-blue-500' : 'text-zinc-500 border-transparent'}`}
                                >
                                    Voices
                                </button>
                            </div>
                            <div className="flex-1 overflow-hidden relative">
                                {splitPanelContent === 'characters' ? (
                                    <CharacterGrid 
                                        items={filteredCharacters} 
                                        onView={(c) => { 
                                            const chat = chatsIndex.find(chat => chat.chatUrl === c.url);
                                            if (chat) {
                                                setSplitPanelContent('chats');
                                                setActiveChatId(chat.chatId);
                                            }
                                        }} 
                                        onExport={(c) => {
                                            const chat = chatsIndex.find(chat => chat.chatUrl === c.url);
                                            if (chat) {
                                                handleExport(chat.chatId);
                                            } else {
                                                // Fallback: try to export by URL directly if we have it
                                                if (c.url) {
                                                    window.electronAPI.exportChat(c.url, c.name, false, c.avatarUrl)
                                                        .then(() => {
                                                            // Refresh export entries
                                                            window.electronAPI.getExportIndex().then(idx => setExportEntries(idx.exports));
                                                        })
                                                        .catch(e => setAppError(`Export failed: ${e.message}`));
                                                } else {
                                                    setAppError("Cannot export: No chat URL found for this character.");
                                                }
                                            }
                                        }} 
                                    />
                                ) : splitPanelContent === 'chats' ? (
                                    activeChatId ? (
                                        <div className="h-full flex flex-col">
                                            <button onClick={() => setActiveChatId(null)} className="p-2 text-xs text-zinc-400 hover:text-white flex items-center gap-2 border-b border-white/5 bg-[#18181b]">
                                                <ArrowLeft size={14} /> Back to Chats
                                            </button>
                                            <div className="flex-1 overflow-hidden">
                                                <ChatViewerPanel 
                                                    messages={selectedTranscript}
                                                    characterName={activeChatMeta?.characterName || 'Unknown'}
                                                    characterAvatarUrl={activeChatMeta?.avatarUrl}
                                                    viewerHandle={userProfile?.handle}
                                                    viewerAvatarUrl={userProfile?.avatarUrl}
                                                    search={transcriptSearch}
                                                    loading={loadingTranscript}
                                                    error={transcriptError}
                                                    exportDir={activeExport?.exportDirAbsolutePath}
                                                    transcriptPath={activeExport?.transcriptPath}
                                                    onOpenFolder={handleOpenExportFolder}
                                                    onOpenTranscript={() => window.electronAPI.openFile(activeExport?.transcriptPath || '')}
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <ChatList 
                                            chats={chatsIndex} 
                                            exports={exportEntries} 
                                            selectedChatId={activeChatId} 
                                            onSelectChat={(id) => {
                                                setActiveChatId(id);
                                            }} 
                                            searchTerm="" 
                                            onSearchChange={() => {}} 
                                        />
                                    )
                                ) : splitPanelContent === 'personas' ? (
                                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2">
                                        <Users size={32} className="opacity-20" />
                                        <p>Personas Manager</p>
                                        <p className="text-xs opacity-50">Coming Soon</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2">
                                        <Mic2 size={32} className="opacity-20" />
                                        <p>Voices Manager</p>
                                        <p className="text-xs opacity-50">Coming Soon</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Settings Overlay */}
            {viewTab === 'settings' && (
                <div className="absolute inset-0 z-20 bg-[#09090b]">
                    <SettingsPanel />
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
