import React, { useMemo, useState } from "react";
import { Search, CheckCircle2, Clock3 } from "lucide-react";

import type { ChatIndexEntry, ExportIndexEntry } from "../../types";

type Props = {
  chats: ChatIndexEntry[];
  exports: ExportIndexEntry[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  searchTerm: string;
  onSearchChange: (val: string) => void;
};

const PAGE_SIZE = 250;

function fmtRelative(tsStr?: string): string | null {
  if (!tsStr) return null;
  const tsMs = new Date(tsStr).getTime();
  if (isNaN(tsMs)) return null;
  
  const delta = Date.now() - tsMs;
  if (delta < 0) return "just now";
  const min = Math.floor(delta / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function ChatList({
  chats,
  exports,
  selectedChatId,
  onSelectChat,
  searchTerm,
  onSearchChange,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = (searchTerm || "").trim().toLowerCase();
    const base = q
      ? chats.filter((c) => {
          const hay = `${c.characterName ?? ""} ${c.chatId ?? ""}`.toLowerCase();
          return hay.includes(q);
        })
      : chats;

    // Default sort: most recently active first (if available), else stable.
    return [...base].sort((a, b) => {
      const at = new Date(a.updatedAt).getTime() || 0;
      const bt = new Date(b.updatedAt).getTime() || 0;
      return bt - at;
    });
  }, [chats, searchTerm]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const canLoadMore = visibleCount < filtered.length;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
            <input
              className="w-full rounded-xl bg-white/5 border border-white/10 pl-9 pr-3 py-2 text-sm text-white/90 placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
              placeholder="Search chats…"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="text-xs text-white/50 tabular-nums">
            {filtered.length.toLocaleString()}
          </div>
        </div>
        <div className="mt-2 text-xs text-white/45">
          Showing {Math.min(visibleCount, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()}
          {canLoadMore ? " — load more at bottom" : ""}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="divide-y divide-white/5">
          {visible.map((chat) => {
            const exp = exports.find(e => e.chatId === chat.chatId);
            const exportedAt = exp?.exportedAt ?? undefined;
            const exportedRel = fmtRelative(exportedAt);

            const selected = selectedChatId === chat.chatId;

            return (
              <button
                key={chat.chatId}
                className={`w-full text-left px-3 py-3 transition-colors ${
                  selected ? "bg-white/10" : "hover:bg-white/5"
                }`}
                onClick={() => onSelectChat(chat.chatId)}
                type="button"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-9 w-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-xs text-white/60 overflow-hidden">
                    {chat.avatarUrl ? (
                        <img src={chat.avatarUrl} className="w-full h-full object-cover" />
                    ) : (
                        (chat.characterName?.[0] ?? "?").toUpperCase()
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white/90 font-medium">
                          {chat.characterName || "Unknown character"}
                        </div>
                        <div className="truncate text-xs text-white/45">
                          {chat.chatId}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {exportedAt ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-200 border border-emerald-500/20 px-2 py-0.5 text-[11px]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {exportedRel ? `${exportedRel}` : "Exported"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 text-white/60 border border-white/10 px-2 py-0.5 text-[11px]">
                            <Clock3 className="h-3.5 w-3.5" />
                            Not exported
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="p-6 text-sm text-white/55">No chats match your search.</div>
        )}

        {canLoadMore && (
          <div className="p-3">
            <button
              type="button"
              className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 py-2 text-sm text-white/80"
              onClick={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length))}
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
