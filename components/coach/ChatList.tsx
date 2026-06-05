"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  ChevronRight,
  ArrowRight,
  Sparkles,
  MoreVertical,
  Pencil,
  Trash2,
  X,
  Check,
} from "lucide-react";
import type { ChatThread } from "@/app/(app)/home/actions";
import { deleteThread, renameThread } from "@/app/(app)/coach/threadActions";

interface ChatListProps {
  threads: ChatThread[];
}

export function ChatList({ threads: initialThreads }: ChatListProps) {
  // Local mirror of the threads list. Optimistic delete pops a row out
  // immediately; the server action and router.refresh() reconcile after.
  // Optimistic rename swaps the title in place.
  const [threads, setThreads] = useState<ChatThread[]>(initialThreads);

  // Keep the list in sync if the parent re-fetches (e.g. after sending a
  // chat message and router.refresh() bubbles up).
  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-4">
        <div className="h-14 w-14 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
          <MessageSquare className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
        </div>
        <p className="text-base font-semibold text-gray-900 dark:text-white mb-2">
          No conversations yet
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Tap &ldquo;Start a new conversation&rdquo; above, or log a workout and
          ask your coach about it.
        </p>
        <Link
          href="/home"
          className="flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          Go log a workout
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {threads.map((thread) => (
        <ChatListRow
          key={thread.id}
          thread={thread}
          onLocalDelete={() =>
            setThreads((prev) => prev.filter((t) => t.id !== thread.id))
          }
          onLocalRename={(title) =>
            setThreads((prev) =>
              prev.map((t) => (t.id === thread.id ? { ...t, title } : t)),
            )
          }
        />
      ))}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────
// Per-row component so the 3-dot menu, rename input, and delete-confirm
// states live in their own React subtree. Clicking the menu mustn't navigate,
// so we stop event propagation on the menu/edit-mode UI.

interface ChatListRowProps {
  thread: ChatThread;
  onLocalDelete: () => void;
  onLocalRename: (title: string) => void;
}

function ChatListRow({ thread, onLocalDelete, onLocalRename }: ChatListRowProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameMode, setRenameMode] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [renameValue, setRenameValue] = useState(thread.title);
  const [, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Click-outside dismissal for the menu popover. Captures the document so
  // even clicks on the row chevron close it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  // Auto-focus the rename input when entering rename mode so the user can
  // type immediately. Select-all so they can overwrite the existing title.
  useEffect(() => {
    if (renameMode && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameMode]);

  const isWorkout = thread.kind === "workout";
  const Icon = isWorkout ? MessageSquare : Sparkles;
  // Always use thread.title as the headline so renames take effect visually.
  // Default workout titles (set in getOrCreateWorkoutThread) look like
  // "Run debrief — 4 Jun" which is already a useful label.
  const headline = thread.title;
  const subline = thread.lastMessage?.trim()
    ? thread.lastMessage
    : "No messages yet — tap to start.";

  const stop = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === thread.title) {
      setRenameMode(false);
      setRenameValue(thread.title);
      return;
    }
    // Optimistic update — server can still reject (network error, ownership
    // mismatch) and we'll revert.
    const prevTitle = thread.title;
    onLocalRename(trimmed);
    setRenameMode(false);
    startTransition(async () => {
      const res = await renameThread(thread.id, trimmed);
      if (!res.success) {
        console.error("renameThread failed:", res.error);
        onLocalRename(prevTitle); // revert
      } else {
        router.refresh();
      }
    });
  };

  const handleDeleteConfirm = () => {
    // Optimistic removal from the list. If the server fails we'd ideally
    // re-insert at the same index, but since this is a single-user app with
    // a reliable backend we accept the simpler model: refresh on failure
    // so the list rehydrates from the DB.
    onLocalDelete();
    setDeleteConfirm(false);
    setMenuOpen(false);
    startTransition(async () => {
      const res = await deleteThread(thread.id);
      if (!res.success) {
        console.error("deleteThread failed:", res.error);
        router.refresh();
      } else {
        router.refresh();
      }
    });
  };

  // ── Rename mode ──────────────────────────────────────────────────────
  // Replaces the row content with an inline input + confirm/cancel buttons.
  // Wraps in a div (not a Link) so clicks don't navigate while editing.
  if (renameMode) {
    return (
      <div className="flex items-center gap-3 rounded-3xl bg-white dark:bg-slate-900 p-4 shadow-sm">
        <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleRenameSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setRenameMode(false);
              setRenameValue(thread.title);
            }
          }}
          maxLength={80}
          className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={handleRenameSubmit}
          className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700"
          aria-label="Save rename"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setRenameMode(false);
            setRenameValue(thread.title);
          }}
          className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:bg-slate-300 dark:hover:bg-slate-600"
          aria-label="Cancel rename"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ── Delete-confirm mode ──────────────────────────────────────────────
  // Slides the row's right side over to show a destructive confirm + cancel
  // pair. Two-step pattern avoids a modal dialog (heavy on mobile).
  if (deleteConfirm) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 shadow-sm">
        <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
          <Trash2 className="h-5 w-5 text-red-600 dark:text-red-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-900 dark:text-red-100">
            Delete this conversation?
          </p>
          <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
            All messages will be permanently removed.
          </p>
        </div>
        <button
          onClick={handleDeleteConfirm}
          className="rounded-full bg-red-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700"
        >
          Delete
        </button>
        <button
          onClick={() => setDeleteConfirm(false)}
          className="rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Default row ──────────────────────────────────────────────────────
  return (
    <div className="relative">
      <Link
        href={`/coach/${thread.id}`}
        className="flex items-center gap-4 rounded-3xl bg-white dark:bg-slate-900 p-4 shadow-sm transition-colors hover:bg-gray-50 dark:hover:bg-slate-800"
      >
        <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize truncate">
              {headline}
            </p>
            <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
              {thread.messageCount} msg{thread.messageCount !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {subline}
          </p>
        </div>
        {/* The chevron is a visual hint only — the whole Link is the tap
            target. Hidden when the 3-dot menu is open so it doesn't crowd. */}
        {!menuOpen && (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </Link>

      {/* 3-dot menu — absolutely positioned so it doesn't push the row layout
          around and so it sits outside the Link's tap area. onMouseDown rather
          than onClick because the document-level click-outside handler fires
          first on iOS otherwise (closes the menu before the row's button
          handler runs). */}
      <div
        ref={menuRef}
        className="absolute top-1/2 right-3 -translate-y-1/2"
        onMouseDown={stop}
        onTouchStart={stop}
      >
        <button
          onClick={(e) => {
            stop(e);
            setMenuOpen((v) => !v);
          }}
          className="h-8 w-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Thread options"
          aria-expanded={menuOpen}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-10 min-w-[160px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
            <button
              onClick={(e) => {
                stop(e);
                setMenuOpen(false);
                setRenameMode(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Pencil className="h-4 w-4" /> Rename
            </button>
            <button
              onClick={(e) => {
                stop(e);
                setMenuOpen(false);
                setDeleteConfirm(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
