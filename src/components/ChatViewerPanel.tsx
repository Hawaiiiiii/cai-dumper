
import React, { useEffect, useRef } from 'react';
import { Bot, User, FolderOpen, FileText, AlertCircle, Calendar } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { TranscriptMessage } from '../../types';

interface ChatViewerPanelProps {
  messages: TranscriptMessage[];
  characterName: string;
  characterAvatarUrl?: string | null;
  viewerHandle?: string;
  viewerAvatarUrl?: string | null;
  search: string;
  loading?: boolean;
  error?: string | null;
  exportDir?: string | null;
  transcriptPath?: string | null;
  onOpenFolder?: () => void;
  onOpenTranscript?: () => void;
}

const ChatViewerPanel: React.FC<ChatViewerPanelProps> = ({
  messages,
  characterName,
  characterAvatarUrl,
  viewerHandle,
  viewerAvatarUrl,
  search,
  loading,
  error,
  exportDir,
  transcriptPath,
  onOpenFolder,
  onOpenTranscript,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // Filter messages based on search
  const displayMessages = React.useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return messages;
    return messages.filter(m => m.text.toLowerCase().includes(q));
  }, [messages, search]);

  // Auto-scroll to bottom on load
  useEffect(() => {
    if (containerRef.current && !search && !loading) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length, search, loading]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#121214]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-sm text-gray-500">Loading transcript...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#121214]">
        <div className="w-12 h-12 bg-red-900/20 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={24} className="text-red-500" />
        </div>
        <h3 className="text-lg font-medium text-white mb-2">Could not load chat</h3>
        <p className="text-sm text-gray-400 max-w-md">{error}</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#121214] text-gray-500">
        <Bot size={48} className="opacity-10 mb-4" />
        <p className="text-sm">No messages to display.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#121214] relative">
      {/* Transcript Header Actions (Floating) */}
      <div className="absolute top-4 right-6 z-10 flex gap-2">
        {exportDir && (
          <button 
            onClick={onOpenFolder} 
            className="p-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all shadow-lg" 
            title="Open Folder"
          >
            <FolderOpen size={16} />
          </button>
        )}
        {transcriptPath && (
          <button 
            onClick={onOpenTranscript} 
            className="p-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all shadow-lg" 
            title="View Raw JSONL"
          >
            <FileText size={16} />
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto px-6 py-8 space-y-6 custom-scrollbar"
      >
        {/* Intro */}
        <div className="flex flex-col items-center justify-center py-12 border-b border-white/5 mb-8">
           <div className="w-20 h-20 rounded-full bg-gradient-to-b from-gray-700 to-gray-800 flex items-center justify-center text-3xl font-bold text-white mb-4 shadow-xl overflow-hidden">
             {characterAvatarUrl ? (
                <img src={characterAvatarUrl} alt={characterName} className="w-full h-full object-cover" />
             ) : (
                characterName.charAt(0).toUpperCase()
             )}
           </div>
           <h2 className="text-xl font-bold text-white">{characterName}</h2>
           <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              {messages.length} messages exported
           </p>
        </div>

        {displayMessages.map((msg, idx) => {
          const isUser = msg.sender === 'viewer';
          // Use explicit handle if available, fallback to "You" for user
          const senderName = isUser ? (viewerHandle || 'You') : (characterName || 'Character');
          
          return (
            <div key={msg.id || idx} className={`flex gap-4 group ${isUser ? 'justify-end' : 'justify-start'}`}>
              
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex-shrink-0 flex items-center justify-center text-gray-300 text-xs font-bold shadow-md mt-1 overflow-hidden">
                  {characterAvatarUrl ? (
                    <img src={characterAvatarUrl} alt={characterName} className="w-full h-full object-cover" />
                  ) : (
                    characterName.charAt(0).toUpperCase()
                  )}
                </div>
              )}
              
              <div className={`flex flex-col max-w-[70%] ${isUser ? 'items-end' : 'items-start'}`}>
                <div className="text-[11px] text-gray-500 mb-1 px-1 flex items-center gap-2">
                  <span className="font-medium text-gray-400">{senderName}</span>
                  {msg.ts && <span className="opacity-50">{new Date(msg.ts).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
                </div>
                
                <div 
                  className={`px-4 py-3 text-[15px] shadow-sm relative group-hover:shadow-md transition-shadow ${
                    isUser 
                      ? 'bg-[#195EFF] text-white rounded-2xl rounded-tr-sm' 
                      : 'bg-[#27272a] text-gray-200 rounded-2xl rounded-tl-sm'
                  }`}
                >
                  <div className={`markdown-body ${isUser ? 'text-white/95' : 'text-gray-200'}`}>
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                </div>
              </div>

              {isUser && (
                 <div className="w-8 h-8 rounded-full bg-blue-900/30 flex-shrink-0 flex items-center justify-center text-blue-200 border border-blue-800/30 text-xs mt-1 overflow-hidden">
                   {viewerAvatarUrl ? (
                     <img src={viewerAvatarUrl} alt="You" className="w-full h-full object-cover" />
                   ) : (
                     <User size={14} />
                   )}
                 </div>
              )}
            </div>
          );
        })}
        
        <div className="h-8"></div> {/* Bottom spacer */}
      </div>
    </div>
  );
};

export default ChatViewerPanel;
