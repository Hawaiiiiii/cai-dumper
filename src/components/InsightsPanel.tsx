import React, { useMemo } from 'react';
import { BarChart2 } from 'lucide-react';
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

  return (
    <div className="bg-gray-950 border border-gray-900 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-gray-200 font-semibold">
        <BarChart2 size={16} /> Insights (basic)
      </div>
      {insights?.warnings?.length ? (
        <div className="text-xs text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl p-2">
          {insights.warnings.join(' ')}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Messages" value={total} />
        <Stat label="You" value={userCount} />
        <Stat label="Character" value={charCount} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Avg length" value={`${avgChars} chars`} />
        <Stat label="Avg words" value={`${avgWords}`} />
      </div>

      <div className="border border-gray-900 rounded-xl p-3 bg-gray-900/60">
        <div className="text-xs text-gray-500 mb-2">Timeline</div>
        {(!insights || !insights.timelineBuckets?.length) ? (
          <div className="text-xs text-gray-500">No timestamps available.</div>
        ) : (
          <div className="flex items-end gap-[2px] h-16">
            {insights.timelineBuckets.slice(-60).map((b) => (
              <div key={b.date} className="flex-1 min-w-[2px]" title={`${b.date}: ${b.count}`}>
                <div
                  className="w-full bg-amber-500/40 border border-amber-400/30 rounded-sm"
                  style={{ height: `${Math.max(2, Math.round((b.count / (maxBucket || 1)) * 64))}px` }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="border border-gray-900 rounded-xl p-3 bg-gray-900/60 text-gray-300">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="text-lg font-semibold text-gray-100">{value}</div>
  </div>
);

export default InsightsPanel;