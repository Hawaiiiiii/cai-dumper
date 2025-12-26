import React from 'react';
import { ChatMessage } from '../types';
import { MessageSquare, Users, HardDrive, Activity } from 'lucide-react';

const StatCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex items-center justify-between">
    <div>
      <p className="text-gray-500 text-sm font-medium mb-1">{label}</p>
      <h3 className="text-2xl font-bold text-gray-100">{value}</h3>
    </div>
    <div className={`p-3 rounded-lg ${color} bg-opacity-10`}>
      <Icon className={color.replace('bg-', 'text-')} size={24} />
    </div>
  </div>
);

const Dashboard: React.FC<{ activeChat: ChatMessage[] | null }> = ({ activeChat }) => {
  return (
    <div className="p-8 bg-gray-950 h-full overflow-y-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Overview</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <StatCard label="Loaded Chats" value={activeChat ? "1" : "0"} icon={MessageSquare} color="text-blue-500 bg-blue-500" />
        <StatCard label="Total Messages" value={activeChat?.length || 0} icon={Activity} color="text-green-500 bg-green-500" />
        <StatCard label="Characters" value={activeChat ? "1" : "0"} icon={Users} color="text-purple-500 bg-purple-500" />
        <StatCard label="Storage Used" value={activeChat ? "24 KB" : "0 KB"} icon={HardDrive} color="text-amber-500 bg-amber-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold text-gray-200 mb-4">Quick Actions</h3>
            <div className="space-y-3">
                <button className="w-full text-left px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg text-sm text-gray-300 transition-colors">
                    Import local .JSONL file
                </button>
                <button className="w-full text-left px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg text-sm text-gray-300 transition-colors">
                    Configure API Keys
                </button>
                 <button className="w-full text-left px-4 py-3 bg-gray-800 hover:bg-gray-750 rounded-lg text-sm text-gray-300 transition-colors">
                    View Export History
                </button>
            </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col justify-center items-center text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <HardDrive className="text-gray-600" size={24} />
            </div>
            <h3 className="text-gray-200 font-medium">No Recent Exports</h3>
            <p className="text-gray-500 text-sm mt-2 max-w-xs">
                Connect the scraper in the "Scraper" tab to start archiving your character.ai history.
            </p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
