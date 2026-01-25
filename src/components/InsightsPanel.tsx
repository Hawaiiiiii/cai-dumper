import React, { useMemo } from 'react';
import { BarChart2, MessageSquare, User, Bot, Type, Clock } from 'lucide-react';
import { TranscriptInsights } from '../../types';

interface InsightsPanelProps {
  insights: TranscriptInsights | null;
  summaryMarkdown?: string | null;
}

const InsightsPanel: React.FC<InsightsPanelProps> = ({ insights }) => {
  const maxBucket = useMemo(() => {
    const arr = insights?.timelineBuckets || [];
    return arr.reduce((m, b) => Math.max(m, b.count), 0);
  }, [insights]);

  const total = insights?.totalMessages || 0;
  const userCount = insights?.viewerMessages || 0;
  const charCount = insights?.characterMessages || 0;
  const avgChars = insights ? Math.round(insights.avgCharsPerMessage) : 0;
  const avgWords = insights ? Math.round(insights.avgWordsPerMessage) : 0;

  if (!insights) {
      return (
          <div className="p-6 text-center text-zinc-500 text-sm">
              Select a chat to view insights.
          </div>
      )
  }

  return (
    <div className="h-full flex flex-col bg-[#0d0d10]">
      <div className="p-4 border-b border-white/5 flex items-center gap-2">
        <BarChart2 size={16} className="text-blue-400" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Chat Analytics</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        
        {insights?.warnings?.length ? (
            <div className="text-xs text-amber-200 border border-amber-500/20 bg-amber-500/10 rounded-lg p-3">
            {insights.warnings.join(' ')}
            </div>
        ) : null}

        {/* Key Stats */}
        <section>
            <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Volume</h4>
            <div className="grid grid-cols-2 gap-3">
                <StatCard icon={MessageSquare} label="Total Messages" value={total} color="text-white" />
                <StatCard icon={Clock} label="Avg Length" value={`${avgWords} words`} sub={`${avgChars} chars`} color="text-zinc-300" />
            </div>
        </section>

        {/* Distribution */}
        <section>
            <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Distribution</h4>
            <div className="space-y-3">
                <div className="bg-[#18181b] border border-white/5 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <User size={12} /> You
                        </div>
                        <span className="text-sm font-bold text-white">{userCount}</span>
                    </div>
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(userCount / total) * 100}%` }}></div>
                    </div>
                </div>

                <div className="bg-[#18181b] border border-white/5 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <Bot size={12} /> Character
                        </div>
                        <span className="text-sm font-bold text-white">{charCount}</span>
                    </div>
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500" style={{ width: `${(charCount / total) * 100}%` }}></div>
                    </div>
                </div>
            </div>
        </section>

        {/* Timeline */}
        <section>
            <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Activity Timeline</h4>
            <div className="bg-[#18181b] border border-white/5 rounded-xl p-4">
                {(!insights || !insights.timelineBuckets?.length) ? (
                <div className="text-xs text-zinc-500 text-center py-4">No timestamps available.</div>
                ) : (
                <div className="flex items-end gap-[2px] h-24">
                    {insights.timelineBuckets.slice(-40).map((b) => (
                    <div key={b.date} className="flex-1 min-w-[4px] group relative" >
                        <div
                        className="w-full bg-blue-500/20 border-t border-blue-500/50 rounded-t-sm hover:bg-blue-500 transition-colors"
                        style={{ height: `${Math.max(4, Math.round((b.count / (maxBucket || 1)) * 100))}%` }}
                        />
                        {/* Tooltip */}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 bg-black border border-white/10 text-[10px] text-white px-2 py-1 rounded whitespace-nowrap pointer-events-none">
                            {b.date}: {b.count} msgs
                        </div>
                    </div>
                    ))}
                </div>
                )}
            </div>
        </section>
      </div>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, sub, color }: any) => (
  <div className="bg-[#18181b] border border-white/5 rounded-xl p-3 flex flex-col justify-between h-24">
    <div className="flex items-start justify-between">
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{label}</div>
        <Icon size={14} className="text-zinc-600" />
    </div>
    <div>
        <div className={`text-xl font-bold ${color}`}>{value}</div>
        {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  </div>
);

export default InsightsPanel;