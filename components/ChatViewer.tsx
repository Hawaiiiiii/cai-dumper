import React, { useState } from 'react';
import { ChatMessage } from '../types';
import { Search, User, Bot } from 'lucide-react';

interface ChatViewerProps {
  messages: ChatMessage[];
  characterName: string;
}

const ChatViewer: React.FC<ChatViewerProps> = ({ messages, characterName }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredMessages = messages.filter(m => 
    m.text.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Toolbar */}
      <div className="h-16 border-b border-gray-800 px-6 flex items-center justify-between bg-gray-900/50 backdrop-blur">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-200">
            {characterName} <span className="text-gray-500 text-sm font-normal">({messages.length} messages)</span>
          </h2>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input
            type="text"
            placeholder="Search transcript..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 pl-9 pr-4 py-1.5 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 w-64"
          />
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {filteredMessages.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p>No messages found.</p>
          </div>
        ) : (
          filteredMessages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              
              {msg.role !== 'user' && (
                <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1 border border-indigo-500/30">
                  <Bot size={16} className="text-indigo-400" />
                </div>
              )}

              <div className={`max-w-[70%] space-y-1 ${msg.role === 'user' ? 'items-end flex flex-col' : ''}`}>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xs font-medium ${msg.role === 'user' ? 'text-amber-400' : 'text-indigo-400'}`}>
                    {msg.role === 'user' ? 'You' : characterName}
                  </span>
                  <span className="text-[10px] text-gray-600">#{msg.turn_index}</span>
                </div>
                <div 
                  className={`p-3 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user' 
                      ? 'bg-amber-500/10 text-amber-100 border border-amber-500/20 rounded-tr-none' 
                      : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-1 border border-amber-500/30">
                  <User size={16} className="text-amber-400" />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatViewer;
