import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatViewer from './components/ChatViewer';
import Analyzer from './components/Analyzer';
import Architecture from './components/Architecture';
import ScraperView from './components/ScraperView';
import Dashboard from './components/Dashboard';
import { ViewState, ChatMessage } from './types';
import { DEMO_CHAT_LOG } from './constants';
import { geminiService } from './services/geminiService';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');
  // Fix: Cast DEMO_CHAT_LOG to ChatMessage[] because the constant is inferred with string roles, 
  // which mismatches the literal union type in ChatMessage interface.
  const [messages, setMessages] = useState<ChatMessage[]>(DEMO_CHAT_LOG as ChatMessage[]);
  const [characterName] = useState('AI Assistant');

  // Attempt to find API key in URL params for convenience during demo
  useEffect(() => {
    if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const key = params.get('key');
        if (key) {
            geminiService.setApiKey(key);
            console.log("API Key configured from URL");
        }
    }
  }, []);

  const renderContent = () => {
    switch (currentView) {
      case 'DASHBOARD':
        return <Dashboard activeChat={messages} />;
      case 'SCRAPER':
        return <ScraperView />;
      case 'VIEWER':
        return <ChatViewer messages={messages} characterName={characterName} />;
      case 'ANALYSIS':
        return <Analyzer messages={messages} characterName={characterName} />;
      case 'ARCHITECTURE':
        return <Architecture />;
      default:
        return <Dashboard activeChat={messages} />;
    }
  };

  return (
    <div className="flex h-screen w-screen bg-black text-gray-100 font-sans overflow-hidden">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="flex-1 h-full relative">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;