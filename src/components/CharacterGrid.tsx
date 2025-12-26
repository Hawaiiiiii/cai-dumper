import React from 'react';
import CharacterCard, { CharacterCardData } from './CharacterCard';

interface CharacterGridProps {
  items: CharacterCardData[];
  onExport: (c: CharacterCardData) => void;
  onView: (c: CharacterCardData) => void;
}

const CharacterGrid: React.FC<CharacterGridProps> = ({ items, onExport, onView }) => {
  return (
    <div className="grid xl:grid-cols-3 lg:grid-cols-2 md:grid-cols-2 grid-cols-1 gap-4">
      {items.map((c) => (
        <CharacterCard key={c.id} data={c} onExport={onExport} onView={onView} />
      ))}
    </div>
  );
};

export default CharacterGrid;