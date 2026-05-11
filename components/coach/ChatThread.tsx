"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Brain, Send, ArrowLeft, Check, X, Undo2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { coachChatTurn } from "@/app/(app)/home/actions";
import type { ChatMessage } from "@/app/(app)/home/actions";
import {
  applyChatAction,
  declineChatAction,
  revertChatAction,
  type ChatActionView,
} from "@/app/(app)/coach/actions";

interface ChatThreadProps {
  workoutLogId: string;
  initialMessages: ChatMessage[];
  initialActions: ChatActionView[];
}

// Hebrew Unicode block — for detecting RTL content and mirroring layout.
const HEBREW_RE = /[֐-׿]/;

export function ChatThread({ workoutLogId, initialMessages, initialActions }: ChatThreadProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [actions, setActions] = useState<ChatActionView[]>(initialActions);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [, startActionTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // RTL detection — if the most recent user message OR the current input
  // contains Hebrew characters, mirror the chat layout (user bubbles on the
  // left, assistant on the right; right-aligned dates).
  const isRtl =
    HEBREW_RE.test(input) ||
    [...messages].reverse().find((m) => m.role === "user")?.content?.match(HEBREW_RE) != null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // When the server-component parent re-fetches (e.g. after router.refresh()),
  // sync the actions list so newly-emitted proposals appear without a remount.
  useEffect(() => {
    setActions(initialActions);
  }, [initialActions]);

  // Auto-grow the textarea height with content. Capped via CSS max-height
  // (~5 lines) so it doesn't take over the screen.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  // ── Proposal action handlers ──────────────────────────────────────────
  // Each updates the local actions state optimistically, then calls the
  // server. On error we roll back to 'pending'. router.refresh() after a
  // successful server change reloads the page-level data (Home / Roadmap
  // pulled fresh state). We also re-fetch via router so the next chat turn
  // sees the new plan in its context.

  const setActionStatus = (id: string, status: ChatActionView["status"]) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  };

  const handleApprove = (id: string) => {
    const original = actions.find((a) => a.id === id)?.status ?? "pending";
    setActionStatus(id, "approved");
    startActionTransition(async () => {
      const res = await applyChatAction(id);
      if (!res.success) {
        console.error("applyChatAction failed:", res.error);
        setActionStatus(id, original);
      } else {
        router.refresh();
      }
    });
  };

  const handleDecline = (id: string) => {
    const original = actions.find((a) => a.id === id)?.status ?? "pending";
    setActionStatus(id, "declined");
    startActionTransition(async () => {
      const res = await declineChatAction(id);
      if (!res.success) {
        console.error("declineChatAction failed:", res.error);
        setActionStatus(id, original);
      }
    });
  };

  const handleRevert = (id: string) => {
    const original = actions.find((a) => a.id === id)?.status ?? "approved";
    setActionStatus(id, "reverted");
    startActionTransition(async () => {
      const res = await revertChatAction(id);
      if (!res.success) {
        console.error("revertChatAction failed:", res.error);
        setActionStatus(id, original);
      } else {
        router.refresh();
      }
    });
  };

  // Human-readable summary of what the coach is proposing, for the card body.
  const formatProposal = (a: ChatActionView): string => {
    const p = a.params;
    switch (a.actionType) {
      case "soften_session":
        return `Ease an upcoming session by ${Number(p.reductionPct ?? 25)}%`;
      case "swap_to_rest":
        return "Replace an upcoming session with a rest day";
      case "freeze_week":
        return `Activate a coach freeze for ${Number(p.days ?? 7)} day${Number(p.days ?? 7) === 1 ? "" : "s"}`;
      case "record_symptom":
        return `Record symptom "${String(p.symptom ?? "")}" at severity ${Number(p.severity ?? 0)}`;
      case "add_session": {
        const title = String(p.title ?? "new session");
        const date = String(p.targetDate ?? "a future date");
        return `Add "${title}" on ${date}`;
      }
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    setInput("");
    const optimisticUser: ChatMessage = {
      id: `opt-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setIsSending(true);

    try {
      const result = await coachChatTurn(text, workoutLogId);
      let replyText: string;
      if ("error" in result) {
        // Per-code user-facing copy. Underlying error is logged server-side.
        switch (result.code) {
          case "auth":
            replyText = "Sign in again to chat with your coach.";
            break;
          case "limit":
            replyText = "This thread reached its 10-turn limit. Start a fresh thread by ending this workout.";
            break;
          case "gemini":
            replyText = "Coach service is temporarily unavailable. Try again in a minute.";
            break;
          case "db":
            replyText = "Couldn't save your message. Try again.";
            break;
          default:
            replyText = "Sorry, something went wrong. Please try again.";
        }
      } else {
        replyText = result.reply;
      }

      const assistantMsg: ChatMessage = {
        id: `opt-reply-${Date.now()}`,
        role: "assistant",
        content: replyText,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      // Pull fresh server state so any proposals emitted by the coach show up
      // as Approve/Decline cards (and the optimistic message gets the real id).
      router.refresh();
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: "Network error. Please try again.", createdAt: new Date() },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    // Fill the available height inside the parent app shell. Using min-h
    // instead of h-screen so the chat doesn't fight the parent layout's
    // header + bottom nav. 100dvh adapts as the mobile Chrome address bar
    // slides in/out. Direction flips for Hebrew so bubbles mirror.
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="flex flex-col max-w-md mx-auto min-h-[calc(100dvh-9rem)]"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-2 pb-4 bg-gray-50 dark:bg-slate-950 sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          className="h-9 w-9 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm"
        >
          <ArrowLeft className="h-4 w-4 text-gray-700 dark:text-gray-300" />
        </button>
        <div className="h-9 w-9 rounded-full bg-indigo-600 flex items-center justify-center">
          <Brain className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Coach AI</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Workout debrief</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="flex justify-center py-8">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              No messages yet — ask your coach anything about this workout.
            </p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const msgActions = msg.role === "assistant"
            ? actions.filter((a) => a.chatMessageId === msg.id)
            : [];
          return (
            <div key={msg.id ?? idx} className="space-y-2">
              <div className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  dir="auto"
                  className={cn(
                    "rounded-2xl px-4 py-2.5 max-w-[80%] text-sm leading-relaxed whitespace-pre-wrap break-words",
                    msg.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 shadow-sm",
                  )}
                >
                  {msg.content}
                </div>
              </div>
              {msgActions.map((a) => (
                <ProposalCard
                  key={a.id}
                  action={a}
                  summary={formatProposal(a)}
                  onApprove={() => handleApprove(a.id)}
                  onDecline={() => handleDecline(a.id)}
                  onRevert={() => handleRevert(a.id)}
                />
              ))}
            </div>
          );
        })}
        {isSending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 bg-white dark:bg-slate-800 shadow-sm">
              <span className="text-sm text-gray-400 dark:text-gray-500">…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — sticky to the bottom of the chat container, sits above the
          parent layout's bottom nav. Textarea auto-grows up to ~5 lines so
          long messages stay visible. dir="auto" flips alignment per content. */}
      <div className="sticky bottom-0 px-4 pb-4 pt-3 bg-gray-50 dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends. Shift+Enter inserts a newline (desktop).
              // Mobile keyboards usually don't have Shift, so Enter always sends.
              if (e.key === "Enter" && !e.shiftKey && !isSending && input.trim()) {
                e.preventDefault();
                handleSend(e as unknown as React.FormEvent);
              }
            }}
            enterKeyHint="send"
            inputMode="text"
            autoComplete="off"
            dir="auto"
            rows={1}
            placeholder="Ask your coach anything…"
            disabled={isSending}
            className="flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm leading-relaxed text-slate-900 placeholder-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 max-h-32"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Proposal card ─────────────────────────────────────────────────
// Rendered inline below the assistant message that emitted the function call.
// Pending → Approve / Decline. Approved → ✓ Applied · Undo. Declined → ✗.
// Reverted → ↶.

interface ProposalCardProps {
  action: ChatActionView;
  summary: string;
  onApprove: () => void;
  onDecline: () => void;
  onRevert: () => void;
}

function ProposalCard({ action, summary, onApprove, onDecline, onRevert }: ProposalCardProps) {
  const accentByStatus: Record<ChatActionView["status"], string> = {
    pending: "border-indigo-200 dark:border-indigo-800/60",
    approved: "border-emerald-200 dark:border-emerald-800/60",
    declined: "border-slate-200 dark:border-slate-700 opacity-60",
    reverted: "border-slate-200 dark:border-slate-700 opacity-60",
  };

  return (
    <div
      className={cn(
        "ml-2 rounded-2xl border bg-white dark:bg-slate-900 p-3 shadow-sm max-w-[88%]",
        accentByStatus[action.status],
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40">
          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            Coach proposes
          </p>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
            {summary}
          </p>
          {action.reason && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              {action.reason}
            </p>
          )}

          {action.status === "pending" && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={onApprove}
                className="flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
              <button
                onClick={onDecline}
                className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Decline
              </button>
            </div>
          )}

          {action.status === "approved" && (
            <div className="mt-3 flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Applied
              </span>
              <button
                onClick={onRevert}
                className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </button>
            </div>
          )}

          {action.status === "declined" && (
            <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              <X className="inline h-3.5 w-3.5 mr-1" />
              Declined
            </p>
          )}

          {action.status === "reverted" && (
            <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Undo2 className="inline h-3.5 w-3.5 mr-1" />
              Reverted
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
