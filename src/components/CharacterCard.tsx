
import React from 'react';
import { Download, MessageSquare, User, BarChart2, Clock } from 'lucide-react';
import { CharacterCardData } from '../../types';

interface CharacterCardProps {
  data: CharacterCardData;
  onExport?: (data: CharacterCardData) => void;
  onView?: (data: CharacterCardData) => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ data, onExport, onView }) => {
  return (
    <div 
        className="group relative bg-[#18181b] border border-white/5 rounded-xl overflow-hidden hover:border-white/20 transition-all duration-300 hover:shadow-2xl hover:shadow-black/50 hover:-translate-y-1 flex flex-col h-[280px]"
        onClick={() => onView?.(data)}
    >
      {/* Image Area - Netflix Style */}
      <div className="relative h-32 w-full bg-zinc-800">
        {/* Banner Image Wrapper with Overflow Hidden */}
        <div className="w-full h-full overflow-hidden relative">
            {data.avatarUrl ? (
                <>
                    <img src={data.avatarUrl} alt={data.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#18181b] to-transparent opacity-90"></div>
                </>
            ) : (
                <div className="w-full h-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center">
                    <span className="text-4xl font-bold text-white/10">{data.name.charAt(0)}</span>
                </div>
            )}
        </div>
        
        {/* Floating Avatar - Positioned relative to the Image Area container but visually overlapping */}
        <div className="absolute -bottom-6 left-4 z-10">
            {data.avatarUrl ? (
                <img src={data.avatarUrl} className="w-12 h-12 rounded-full border-2 border-[#18181b] shadow-lg" />
            ) : (
                <div className="w-12 h-12 rounded-full bg-zinc-700 border-2 border-[#18181b] flex items-center justify-center text-white font-bold">
                    {data.name.charAt(0)}
                </div>
            )}
        </div>
      </div>

      {/* Content Area */}
      <div className="p-4 pt-8 flex-1 flex flex-col">
        <h3 className="text-base font-bold text-white truncate mb-1 group-hover:text-blue-400 transition-colors" title={data.name}>
            {data.name}
        </h3>
        
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 mb-3">
            <span className="truncate max-w-[120px]">{data.creator || 'Unknown'}</span>
            {data.interactions && (
                <>
                    <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
                    <span className="flex items-center gap-1"><MessageSquare size={10} /> {data.interactions}</span>
                </>
            )}
            {/* Likes - Added dynamically */}
            {(data as any).likes && (
                <>
                    <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
                    <span className="flex items-center gap-1">
                        <svg viewBox="0 0 24 24" fill="none" width="10" height="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 11H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3m0-9v9m0-9 4-8h.616a2 2 0 0 1 1.976 2.308L13.016 9h5.047a3 3 0 0 1 2.973 3.405l-.682 5A3 3 0 0 1 17.38 20H7"></path>
                        </svg>
                        {(data as any).likes}
                    </span>
                </>
            )}
        </div>

        {/* Last Chat Timestamp (Mock/Placeholder if missing) */}
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mb-4">
            <Clock size={10} />
            <span>Last chat: Recently</span>
        </div>

        {/* Actions */}
        <div className="mt-auto grid grid-cols-2 gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 translate-y-2 group-hover:translate-y-0">
            <button
                onClick={(e) => { e.stopPropagation(); onExport?.(data); }}
                className="flex items-center justify-center gap-2 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-lg shadow-blue-900/20"
            >
                <Download size={12} /> Export
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); }}
                disabled
                className="flex items-center justify-center gap-2 py-1.5 rounded-md bg-zinc-800 text-zinc-500 text-xs font-medium cursor-not-allowed border border-white/5"
            >
                <BarChart2 size={12} /> Analyze
            </button>
        </div>
      </div>
    </div>
  );
};

export default CharacterCard;
