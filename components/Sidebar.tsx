import React from 'react';
import { ViewState } from '../types';
import { LayoutDashboard, Download, FileText, BrainCircuit, BookOpen, Settings } from 'lucide-react';

interface SidebarProps {
  currentView: ViewState;
  onViewChange: (view: ViewState) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange }) => {
  const menuItems = [
    { id: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'SCRAPER', label: 'Scraper / Connect', icon: Download },
    { id: 'VIEWER', label: 'Chat Viewer', icon: FileText },
    { id: 'ANALYSIS', label: 'AI Analysis', icon: BrainCircuit },
    { id: 'ARCHITECTURE', label: 'Architecture & Code', icon: BookOpen },
  ];

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-full">
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
          CAI Dumper
        </h1>
        <p className="text-xs text-gray-500 mt-1">V1.0.0 (Architect Edition)</p>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id as ViewState)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <button className="flex items-center gap-3 px-4 py-3 text-gray-500 hover:text-gray-300 transition-colors w-full">
          <Settings size={18} />
          <span className="text-sm">Settings</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
