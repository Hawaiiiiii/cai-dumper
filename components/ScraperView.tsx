import React, { useState } from 'react';
import { Play, RotateCcw, Download, CheckCircle, ShieldAlert } from 'lucide-react';

const ScraperView: React.FC = () => {
    const [status, setStatus] = useState('IDLE');
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const handleLaunch = () => {
        setStatus('LAUNCHING');
        addLog('Initializing Chromium persistent context...');
        setTimeout(() => {
            addLog('Browser launched. Waiting for manual login...');
            setStatus('WAITING_LOGIN');
        }, 1500);
    };

    const handleScan = () => {
        if (status !== 'WAITING_LOGIN') return;
        setStatus('SCANNING');
        addLog('Scanning left sidebar for recent chats...');
        setTimeout(() => {
            addLog('Found 12 chats.');
            setStatus('READY_TO_EXPORT');
        }, 2000);
    };

    return (
        <div className="p-8 h-full bg-gray-950 flex flex-col items-center justify-center">
            <div className="max-w-2xl w-full bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
                <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-200">Scraper Control Center</h3>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${status === 'IDLE' ? 'bg-gray-500' : 'bg-green-500 animate-pulse'}`}></span>
                        <span className="text-xs font-mono text-gray-400">{status}</span>
                    </div>
                </div>
                
                <div className="p-8 flex flex-col gap-6">
                    <div className="bg-blue-900/10 border border-blue-500/20 p-4 rounded-lg flex gap-3">
                        <ShieldAlert className="text-blue-400 flex-shrink-0" />
                        <p className="text-sm text-blue-200">
                            This interface simulates the Electron scraper controls. 
                            In the real app, this connects to the Playwright process via IPC.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <button 
                            onClick={handleLaunch}
                            disabled={status !== 'IDLE'}
                            className="flex flex-col items-center justify-center p-6 bg-gray-800 rounded-xl hover:bg-gray-750 border border-gray-700 transition-all disabled:opacity-50"
                        >
                            <Play size={32} className="text-amber-500 mb-2" />
                            <span className="font-semibold text-gray-300">1. Launch Browser</span>
                            <span className="text-xs text-gray-500 mt-1">Headful Mode</span>
                        </button>

                        <button 
                             onClick={handleScan}
                             disabled={status !== 'WAITING_LOGIN'}
                             className="flex flex-col items-center justify-center p-6 bg-gray-800 rounded-xl hover:bg-gray-750 border border-gray-700 transition-all disabled:opacity-50"
                        >
                            <RotateCcw size={32} className="text-cyan-500 mb-2" />
                            <span className="font-semibold text-gray-300">2. Scan Sidebar</span>
                            <span className="text-xs text-gray-500 mt-1">Discover Chats</span>
                        </button>
                    </div>

                    <div className="bg-black rounded-lg p-4 font-mono text-xs text-green-400 h-48 overflow-y-auto border border-gray-800">
                        <div className="text-gray-600 mb-2"># System Logs</div>
                        {logs.length === 0 && <span className="text-gray-700">Waiting for commands...</span>}
                        {logs.map((log, i) => (
                            <div key={i}>{log}</div>
                        ))}
                    </div>
                </div>

                <div className="p-4 bg-gray-800 border-t border-gray-700 flex justify-end">
                     <button disabled className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg opacity-50 cursor-not-allowed">
                        <Download size={16} />
                        Export Selection (Simulated)
                     </button>
                </div>
            </div>
        </div>
    );
}

export default ScraperView;
