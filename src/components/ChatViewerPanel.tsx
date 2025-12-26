import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, User, FolderOpen, FileText, X } from 'lucide-react';
import { TranscriptMessage } from '../../types';

interface ChatViewerPanelProps {
  messages: TranscriptMessage[];
  characterName: string;
  reverse: boolean;
  search: string;
  loading?: boolean;
  error?: string | null;
  exportDir?: string | null;
  transcriptPath?: string | null;
  summaryPath?: string | null;
  onOpenFolder?: () => void;
  onOpenTranscript?: () => void;
  onOpenSummary?: () => void;
}

const ChatViewerPanel: React.FC<ChatViewerPanelProps> = ({
  messages,
  characterName,
  reverse,
  search,
  loading,
  error,
  exportDir,
  transcriptPath,
  summaryPath,
  onOpenFolder,
  onOpenTranscript,
  onOpenSummary,
}) => {
  const rendered = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const base = q
      ? (messages || []).filter((m) => (m.text || '').toLowerCase().includes(q))
      : (messages || []);
    return reverse ? [...base].reverse() : base;
  }, [messages, reverse, search]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(520);
  const [scrollTop, setScrollTop] = useState(0);
  const [expanded, setExpanded] = useState<TranscriptMessage | null>(null);

  const rowHeight = 96;
  const overscan = 8;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      if (h && h > 100) setHeight(Math.floor(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalHeight = rendered.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(rendered.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const visible = rendered.slice(startIndex, endIndex);

  return (
    <div className="flex-1 min-h-0 bg-gray-950 border border-gray-900 rounded-2xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-900 bg-gray-900/70 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-400">Chat transcript</div>
          <div className="text-gray-100 font-semibold">{characterName}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500">{rendered.length} messages</div>
          {exportDir && (
            <button
              onClick={onOpenFolder}
              className="px-2 py-1 rounded border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1"
              title="Open export folder"
            >
              <FolderOpen size={14} /> Folder
            </button>
          )}
          {transcriptPath && (
            <button
              onClick={onOpenTranscript}
              className="px-2 py-1 rounded border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1"
              title="Open transcript.jsonl"
            >
              <FileText size={14} /> Transcript
            </button>
          )}
          {summaryPath && (
            <button
              onClick={onOpenSummary}
              className="px-2 py-1 rounded border border-gray-800 hover:border-amber-500 text-xs flex items-center gap-1"
              title="Open summary.md"
            >
              <FileText size={14} /> Summary
            </button>
          )}
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-gradient-to-b from-gray-950 to-gray-900 overflow-y-auto"
        onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
      >
        {error && (
          <div className="p-4 text-sm text-red-300 border-b border-gray-900 bg-red-900/10">{error}</div>
        )}
        {loading && (
          <div className="p-4 text-sm text-gray-400 border-b border-gray-900">Loading transcript…</div>
        )}
        {!loading && !error && rendered.length === 0 && (
          <div className="text-center text-gray-600 mt-8">No transcript loaded yet.</div>
        )}
        {rendered.length > 0 && (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: startIndex * rowHeight, left: 0, right: 0 }}>
              {visible.map((msg, i) => (
                <Row
                  key={msg.id}
                  index={startIndex + i}
                  style={{ height: rowHeight }}
                  data={{ items: rendered, characterName }}
                  onExpand={() => setExpanded(msg)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {expanded && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-6">
          <div className="w-full max-w-3xl bg-gray-950 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-900 bg-gray-900/70 flex items-center justify-between">
              <div className="text-sm text-gray-200 font-semibold">Full message</div>
              <button onClick={() => setExpanded(null)} className="text-gray-400 hover:text-gray-200">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-y-auto">
              <div className="text-xs text-gray-500 mb-2">{expanded.sender}{expanded.ts ? ` • ${formatTs(expanded.ts)}` : ''}</div>
              <div className="whitespace-pre-wrap text-sm text-gray-100 leading-relaxed">{expanded.text}</div>
            </div>
            <div className="px-4 py-3 border-t border-gray-900 flex justify-end">
              <button onClick={() => setExpanded(null)} className="px-3 py-2 rounded-lg border border-gray-800 hover:border-amber-500 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function formatTs(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

const Row = ({ index, style, data, onExpand }: any) => {
  const msg: TranscriptMessage = data.items[index];
  const characterName = data.characterName;
  const isViewer = msg.sender === 'viewer';
  const label = isViewer ? (msg.name || 'You') : (msg.name || characterName);
  const tsLabel = formatTs(msg.ts);
  const shouldClamp = msg.text.length > 900 || msg.text.split(/\n/).length > 8;
  return (
    <div style={style} className="px-4 py-2">
      <div className={`flex gap-3 ${isViewer ? 'justify-end' : 'justify-start'}`}>
        {!isViewer && (
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-200 flex-shrink-0">
            <Bot size={16} />
          </div>
        )}
        <div className={`max-w-[70%] ${isViewer ? 'items-end flex flex-col' : ''}`}>
          <div className="flex items-center gap-2 mb-1 text-[11px] text-gray-500">
            <span className={isViewer ? 'text-amber-300' : 'text-gray-300'}>{label}</span>
            {tsLabel && <span>• {tsLabel}</span>}
          </div>
          <div
            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap border ${
              isViewer
                ? 'bg-amber-500/15 text-amber-50 border-amber-400/30'
                : 'bg-gray-900 text-gray-100 border-gray-800'
            }`}
          >
            <div className={shouldClamp ? 'line-clamp-6' : ''}>{msg.text}</div>
            {shouldClamp && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onExpand?.();
                }}
                className="mt-2 text-[11px] text-amber-300 hover:text-amber-200 underline"
              >
                Expand
              </button>
            )}
          </div>
        </div>
        {isViewer && (
          <div className="w-8 h-8 rounded-full bg-gray-800 border border-amber-400/30 flex items-center justify-center text-amber-200 flex-shrink-0">
            <User size={16} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatViewerPanel;