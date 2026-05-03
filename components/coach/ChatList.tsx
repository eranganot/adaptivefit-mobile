"use client";

import Link from "next/link";
import { MessageSquare, ChevronRight } from "lucide-react";
import type { ChatThread } from "@/app/(app)/home/actions";

interface ChatListProps {
  threads: ChatThread[];
}

function formatDate(d: Date): string {
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function ChatList({ threads }: ChatListProps) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-14 w-14 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
          <MessageSquare className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
        </div>
        <p className="text-base font-semibold text-gray-900 dark:text-white mb-1">
          No conversations yet
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Log a workout and chat with your coach — threads will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {threads.map((thread) => (
        <Link
          key={thread.workoutLogId}
          href={`/coach/${thread.workoutLogId}`}
          className="flex items-center gap-4 rounded-3xl bg-white dark:bg-slate-900 p-4 shadow-sm transition-colors hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
                {thread.workoutType} — {formatDate(thread.performedAt)}
              </p>
              <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                {thread.messageCount} msg{thread.messageCount !== 1 ? "s" : ""}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {thread.lastMessage}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        </Link>
      ))}
    </div>
  );
}
