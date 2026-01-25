
import React from 'react';
import CharacterCard from './CharacterCard';
import { CharacterCardData } from '../../types';

interface CharacterGridProps {
  items: CharacterCardData[];
  onExport: (c: CharacterCardData) => void;
  onView: (c: CharacterCardData) => void;
}

const CharacterGrid: React.FC<CharacterGridProps> = ({ items, onExport, onView }) => {
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#09090b] custom-scrollbar scroll-indicator">
        <div className="max-w-[1600px] mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white">Your Characters</h2>
                <div className="text-sm text-gray-500 font-mono">{items.length} items</div>
            </div>
            
            {items.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {items.map((c) => (
                    <CharacterCard key={c.id} data={c} onExport={onExport} onView={onView} />
                ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 border border-dashed border-white/10 rounded-2xl">
                    <p>No characters found.</p>
                    <p className="text-xs opacity-50">Try running a sidebar scan first.</p>
                </div>
            )}
        </div>
    </div>
  );
};

export default CharacterGrid;
