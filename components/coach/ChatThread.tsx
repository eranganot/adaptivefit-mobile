"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Brain, Send, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { coachChatTurn } from "@/app/(app)/home/actions";
import type { ChatMessage } from "@/app/(app)/home/actions";

interface ChatThreadProps {
  workoutLogId: string;
  initialMessages: ChatMessage[];
}

export function ChatThread({ workoutLogId, initialMessages }: ChatThreadProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      const replyText = "error" in result
        ? "Sorry, something went wrong. Please try again."
        : result.reply;

      const assistantMsg: ChatMessage = {
        id: `opt-reply-${Date.now()}`,
        role: "assistant",
        content: replyText,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
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
    <div className="flex flex-col h-screen max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-8 pb-4 bg-gray-50 dark:bg-slate-950 sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          className="h-9 w-9 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm"
        >
          <ArrowLeft className="h-4 w-4 text-gray-700 dark:text-gray-300" />
        </button>
        <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center">
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
        {messages.map((msg, idx) => (
          <div
            key={msg.id ?? idx}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "rounded-2xl px-4 py-2.5 max-w-[80%] text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 shadow-sm",
              )}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 bg-white dark:bg-slate-800 shadow-sm">
              <span className="text-sm text-gray-400 dark:text-gray-500">…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-6 pt-3 bg-gray-50 dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800">
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your coach anything…"
            disabled={isSending}
            className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
