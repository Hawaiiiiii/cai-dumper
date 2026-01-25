
import React, { useState } from 'react';
import { MessageSquare, Users, Sparkles, Mic2, Search, Settings, LogOut, Database, X, Globe } from 'lucide-react';
import { ViewerProfile } from '../../types';

interface AccountSidebarProps {
  activeTab: string;
  onNavigate: (tab: 'characters' | 'chats' | 'personas' | 'voices' | 'settings' | 'browser') => void;
  profile: ViewerProfile | null;
  globalSearch: string;
  onSearchChange: (val: string) => void;
  isSnowing: boolean;
  onToggleSnow: () => void;
}

const FollowersModal = ({ isOpen, onClose, type, profile }: { isOpen: boolean; onClose: () => void; type: 'followers' | 'following'; profile: ViewerProfile | null }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div 
                role="dialog" 
                data-state="open" 
                className="relative bg-[#18181b] border border-white/10 shadow-2xl w-full max-w-md h-[80vh] sm:rounded-xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                    <div className="flex gap-4 text-sm font-medium text-zinc-400">
                        <button 
                            className={`pb-2 border-b-2 transition-colors ${type === 'followers' ? 'text-white border-white' : 'border-transparent hover:text-zinc-200'}`}
                            onClick={() => { /* Switch tab logic if needed */ }}
                        >
                            {profile?.followers || 0} Followers
                        </button>
                        <button 
                            className={`pb-2 border-b-2 transition-colors ${type === 'following' ? 'text-white border-white' : 'border-transparent hover:text-zinc-200'}`}
                            onClick={() => { /* Switch tab logic if needed */ }}
                        >
                            {profile?.following || 0} Following
                        </button>
                    </div>
                    <button onClick={onClose} className="text-zinc-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {/* Dynamic List */}
                    <FollowersList type={type} isOpen={isOpen} />
                </div>
            </div>
        </div>
    );
};

const FollowersList = ({ type, isOpen }: { type: 'followers' | 'following', isOpen: boolean }) => {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fetched, setFetched] = useState(false);

    React.useEffect(() => {
        if (isOpen && !fetched) {
            setLoading(true);
            setError(null);
            window.electronAPI.scrapeFollowersList(type)
                .then((data: any[]) => {
                    setItems(data);
                    setFetched(true);
                })
                .catch((err: any) => {
                    setError(err.message || "Failed to fetch list");
                })
                .finally(() => setLoading(false));
        }
    }, [isOpen, type, fetched]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                <p>Fetching {type}...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2 text-center">
                <LogOut size={24} />
                <p>{error}</p>
                <button onClick={() => setFetched(false)} className="text-xs underline">Retry</button>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm gap-2">
                <Users size={32} className="opacity-20" />
                <p>No {type} found or list is empty.</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg transition-colors">
                    <img 
                        src={item.avatarUrl || 'https://character.ai/images/default_avatar.png'} 
                        alt={item.handle} 
                        className="w-10 h-10 rounded-full object-cover bg-zinc-800"
                    />
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-white truncate">{item.displayName}</div>
                        <div className="text-xs text-zinc-400 truncate">{item.handle}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

const AccountSidebar: React.FC<AccountSidebarProps> = ({ 
  activeTab, 
  onNavigate, 
  profile, 
  globalSearch, 
  onSearchChange,
  isSnowing,
  onToggleSnow
}) => {
  const [activeModal, setActiveModal] = useState<'followers' | 'following' | null>(null);

  const navItems = [
    { id: 'characters', label: 'Characters', icon: Sparkles },
    { id: 'chats', label: 'Chats', icon: MessageSquare },
    { id: 'browser', label: 'Browser', icon: Globe },
    { id: 'personas', label: 'Personas', icon: Users },
    { id: 'voices', label: 'Voices', icon: Mic2 },
  ];

  return (
    <div className="w-[280px] flex flex-col border-r border-white/5 bg-[#0d0d10] h-full flex-shrink-0">
      <FollowersModal 
        isOpen={!!activeModal} 
        onClose={() => setActiveModal(null)} 
        type={activeModal || 'followers'} 
        profile={profile} 
      />
      {/* Phase A2: Account View (Top) */}
      <div className="p-6 border-b border-white/5 flex flex-col items-center text-center">
        <div className="relative mb-3">
            {profile?.avatarUrl ? (
                <div className="relative">
                    <img 
                        src={profile.avatarUrl} 
                        alt={profile.handle} 
                        className="w-[90px] h-[90px] rounded-full object-cover object-top"
                    />
                    {profile?.isPlus && (
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
                            <div className="px-[4px] pt-[4.5px] pb-[5.5px] rounded-[5px] h-[20px] w-auto bg-gradient-to-r from-[#3b82f6] to-[#2563eb] flex items-center justify-center shadow-lg">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 9.16" fill="none" height="10" width="24">
                                    <path d="M5.68 7.17c-.93 0-1.48-.65-1.48-1.75s.55-1.77 1.48-1.77c.71 0 1.13.3 1.25.99h1.1c-.1-1.14-1.02-1.91-2.35-1.91-1.57 0-2.64 1.09-2.64 2.69 0 1.6 1.04 2.67 2.64 2.67 1.38 0 2.27-.77 2.4-1.9h-1.1c-.16.7-.56.98-1.3.98ZM1.52 0a7.72 7.72 0 0 0 0 9.16h1.03a7.66 7.66 0 0 1-1.37-4.58c0-1.71.46-3.38 1.37-4.57Zm8.39 6.48c-.46 0-.79.34-.79.82 0 .48.33.8.8.8.46 0 .78-.34.78-.8s-.32-.82-.79-.82zM25.45 0a7.66 7.66 0 0 1 1.37 4.58 7.66 7.66 0 0 1-1.37 4.57h1.03a7.71 7.71 0 0 0 0-9.16Zm-2.49 2.78H22v2.14h-2.14v.97H22v2.13h.96V5.9h2.14v-.97h-2.14zM17.94.56a.67.67 0 0 0-.7.71c0 .43.28.71.7.71.42 0 .71-.28.71-.7a.68.68 0 0 0-.7-.72zm.56 2.23h-1.13v5.24h1.14zm-4.29-.06c-1.3 0-2.13.64-2.22 1.76h1.11c.06-.53.46-.84 1.08-.84.62 0 .98.29.98.81 0 .27-.08.34-.44.4-.86.14-1.5.22-1.92.35-.66.22-1.02.7-1.02 1.37 0 .94.64 1.51 1.71 1.51.71 0 1.32-.3 1.68-.86h.04v.8h1.1V4.75c0-1.3-.76-2.02-2.1-2.02zm.95 3.02a1.4 1.4 0 0 1-1.45 1.43c-.5 0-.78-.23-.78-.64 0-.34.16-.55.5-.66.34-.11 1.33-.16 1.73-.29z" fill="#fff"></path>
                                </svg>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="w-[90px] h-[90px] rounded-full bg-gradient-to-tr from-zinc-700 to-zinc-600 flex items-center justify-center text-2xl font-bold text-white border-2 border-white/10 shadow-xl">
                {profile?.displayName?.slice(0, 2).toUpperCase() || '??'}
                </div>
            )}
        </div>
        
        <div className="mt-4 flex flex-col items-center gap-1">
            <h2 className="text-xl font-bold text-white flex flex-row gap-1 items-center">{profile?.displayName || 'Guest User'}</h2>
            <div className="text-zinc-500 font-normal text-sm truncate">{profile?.handle || '@not_logged_in'}</div>
        </div>
        
        {/* Stats Row */}
        <div className="mt-2 flex items-center justify-center text-zinc-500 gap-2 text-sm">
            <div className="flex flex-row gap-2 items-center">
                <button onClick={() => setActiveModal('followers')} className="hover:text-zinc-300 transition-colors">{profile?.followers || 0} Followers</button>
                <span>•</span>
                <button onClick={() => setActiveModal('following')} className="hover:text-zinc-300 transition-colors">{profile?.following || 0} Following</button>
            </div>
            <span className="mx-1">|</span>
            <div className="flex items-center gap-1 -mr-1">
                <svg viewBox="0 0 24 24" fill="none" width="1em" height="1em">
                    <path d="M21.5 12c0-5-3.694-8-9.5-8s-9.5 3-9.5 8c0 1.294.894 3.49 1.037 3.83l.037.092c.098.266.49 1.66-1.074 3.722 2.111 1 4.353-.644 4.353-.644 1.551.815 3.397 1 5.147 1 5.806 0 9.5-3 9.5-8Z" stroke="currentColor" strokeLinecap="square" strokeLinejoin="round" strokeWidth="2"></path>
                </svg>
                <p className="whitespace-nowrap">{profile?.interactions || 0} Interactions</p>
            </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex items-center gap-2">
            <button 
                onClick={() => onNavigate('settings')}
                className="inline-flex items-center justify-center px-4 min-w-[80px] h-10 text-sm gap-2 rounded-md bg-zinc-200 text-black hover:bg-zinc-300 transition-colors font-medium"
            >
                <Settings size={16} />
                Settings
            </button>
            <button 
                className="inline-flex items-center justify-center min-w-[40px] w-10 h-10 rounded-md border border-zinc-700 text-zinc-400 hover:bg-white/5 transition-colors"
                title="Share"
            >
                <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" height="1em" width="1em">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                    <polyline points="16 6 12 2 8 6"></polyline>
                    <line x1="12" y1="2" x2="12" y2="15"></line>
                </svg>
            </button>
        </div>
      </div>

      {/* Search */}
      <div className="p-4">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-400 transition-colors" size={14} />
          <input 
            type="text" 
            placeholder="Search..." 
            value={globalSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-[#18181b] border border-white/10 text-gray-200 text-sm rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-blue-500/50 focus:bg-[#202024] transition-all placeholder:text-gray-600"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
        <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider px-3 py-2">Library</div>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id as any)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive 
                  ? 'bg-blue-600/10 text-blue-400' 
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              <item.icon size={18} className={isActive ? "text-blue-400" : "text-zinc-500"} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Footer Actions */}
      <div className="p-3 border-t border-white/5 bg-[#0a0a0c] space-y-1">
        
        {/* Snow Toggle */}
        <button
            onClick={onToggleSnow}
            className={`
                w-full flex items-center justify-center px-4 py-2 rounded-lg transition-all mb-1 text-xs
                ${isSnowing ? 'bg-red-900/40 text-red-200 border border-red-500/20 shadow-[0_0_15px_rgba(220,38,38,0.3)]' : 'text-zinc-500 hover:bg-white/5 hover:text-white'}
            `}
        >
            <Sparkles size={14} className={`mr-2 ${isSnowing ? 'animate-pulse' : ''}`} />
            <span className="font-medium">Let It Snow</span>
        </button>

        <div className="px-3 py-2 text-[10px] text-zinc-700 text-center">
            CAI Dumper v1.0-beta
        </div>
      </div>
    </div>
  );
};

export default AccountSidebar;
