import React from 'react';
import { Download, BarChart2, Clock, UserCircle2 } from 'lucide-react';

export interface CharacterCardData {
  id: string;
  name: string;
  creator?: string;
  creatorAvatarUrl?: string | null;
  interactions?: number;
  lastChat?: string;
  avatarUrl?: string;
  url?: string;
}

interface CharacterCardProps {
  data: CharacterCardData;
  onExport?: (data: CharacterCardData) => void;
  onView?: (data: CharacterCardData) => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ data, onExport, onView }) => {
  const initials = data.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const avatar = data.avatarUrl ? (
    <img src={data.avatarUrl} alt={data.name} className="w-12 h-12 rounded-full object-cover" />
  ) : (
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white font-semibold flex items-center justify-center">
      {initials || 'CA'}
    </div>
  );

  const creatorAvatar = data.creatorAvatarUrl ? (
    <img src={data.creatorAvatarUrl} alt={data.creator || 'Creator'} className="w-5 h-5 rounded-full object-cover border border-gray-800" />
  ) : (
    <div className="w-5 h-5 rounded-full bg-gray-800 text-[10px] text-gray-300 flex items-center justify-center border border-gray-700">
      {(data.creator || '??').slice(0, 2).toUpperCase()}
    </div>
  );

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-4 hover:border-amber-500/40 transition-colors">
      <div className="flex items-center gap-3">
        {avatar}
        <div className="flex-1 min-w-0">
          <div className="text-gray-100 font-semibold truncate">{data.name}</div>
          <div className="text-xs text-gray-500 truncate flex items-center gap-2">
            {creatorAvatar}
            <span className="flex items-center gap-1">
              <UserCircle2 size={14} /> {data.creator || 'Unknown creator'}
            </span>
          </div>
        </div>
        <button
          onClick={() => onView?.(data)}
          className="text-xs px-3 py-1.5 rounded-full border border-gray-700 text-gray-200 hover:border-amber-500 hover:text-amber-200"
        >
          View
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <BarChart2 size={14} className="text-amber-400" />
          <span>{data.interactions ?? '—'} interactions</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-gray-500" />
          <span>{data.lastChat || 'Unknown'}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onExport?.(data)}
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold"
        >
          <Download size={16} /> Export
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-800 text-gray-500 text-sm font-semibold cursor-not-allowed"
          disabled
        >
          <BarChart2 size={16} /> Analyze
        </button>
      </div>
    </div>
  );
};

export default CharacterCard;