import React from 'react';
import { UserCircle2, Users, MessageSquare, Mic2, Sparkles } from 'lucide-react';
import { ViewerProfile } from '../../types';

interface AccountSidebarProps {
  onNavigate?: (section: string) => void;
  active?: string;
  profile?: ViewerProfile | null;
  viewerUpdatedAt?: string | null;
}

const AccountSidebar: React.FC<AccountSidebarProps> = ({ onNavigate, active, profile, viewerUpdatedAt }) => {
  const fmt = (n?: number | null) => {
    if (n === null || n === undefined) return '—';
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  };

  const nav = [
    { id: 'characters', label: 'Characters', icon: Sparkles, enabled: true },
    { id: 'personas', label: 'Personas', icon: Users, enabled: true },
    { id: 'voices', label: 'Voices', icon: Mic2, enabled: true },
    { id: 'chats', label: 'Chats', icon: MessageSquare, enabled: true },
  ];

  return (
    <aside className="w-[280px] bg-gray-950 border-r border-gray-900 flex flex-col h-screen">
      <div className="p-6 border-b border-gray-900 flex items-center gap-3">
        {profile?.avatarUrl ? (
          <img src={profile.avatarUrl} alt={profile.displayName} className="w-12 h-12 rounded-full object-cover border border-amber-500/40" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-semibold">
            {(profile?.displayName || 'CA').slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-gray-50 font-semibold truncate">{profile?.displayName || '—'}</div>
          <div className="text-xs text-gray-500 truncate">{profile?.handle || '—'}</div>
          {viewerUpdatedAt && (
            <div className="text-[10px] text-gray-600 truncate">Updated {new Date(viewerUpdatedAt).toLocaleString()}</div>
          )}
        </div>
      </div>

      <div className="px-6 py-4 border-b border-gray-900">
        <div className="grid grid-cols-3 gap-3 text-center text-xs text-gray-400">
          <div className="bg-gray-900 rounded-lg p-2">
            <div className="text-gray-200 font-semibold">{fmt(profile?.followers)}</div>
            <div>Followers</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-2">
            <div className="text-gray-200 font-semibold">{fmt(profile?.following)}</div>
            <div>Following</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-2">
            <div className="text-gray-200 font-semibold">{fmt(profile?.interactions)}</div>
            <div>Interactions</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4">
        {nav.map((item) => {
          const Icon = item.icon;
          const disabled = !item.enabled;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              disabled={disabled}
              onClick={() => onNavigate?.(item.id)}
              className={`w-full px-5 py-3 flex items-center gap-3 text-sm transition-colors border-l-4 ${
                isActive
                  ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-5 border-t border-gray-900">
        <div className="flex items-center gap-3 text-gray-400 text-sm">
          <UserCircle2 size={18} />
          Read-only mirror
        </div>
        <div className="text-xs text-gray-600 mt-1">
          No actions mutate your Character.AI account. Export & browsing only.
        </div>
      </div>
    </aside>
  );
};

export default AccountSidebar;