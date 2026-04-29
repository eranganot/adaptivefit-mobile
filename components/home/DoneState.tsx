"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Brain, Send } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DoneStateProps {
  summary: string;
  adjustments: string[];
  onBack: () => void;
  onChat: (message: string) => Promise<void>;
  workoutLogId: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function DoneState({
  summary,
  adjustments,
  onBack,
  onChat,
  workoutLogId,
}: DoneStateProps) {
  const t = useTranslations();
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleContinueChat = () => {
    setShowChat(true);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSending || !workoutLogId) return;

    const userMessage = chatInput;
    setChatInput("");

    // Add user message to chat
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    setIsSending(true);
    try {
      await onChat(userMessage);
      // In a real implementation, you'd get the assistant response from the server action
      // For now, we just call the action which handles persistence
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Message received and processed." },
      ]);
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 ring-4 ring-blue-100 dark:bg-blue-500 dark:ring-blue-900/40">
          <Brain className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {t("done.headerTitle")}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{t("done.headerSub")}</p>
        </div>
      </div>

      {/* Analysis Card */}
      <div className="space-y-3 rounded-3xl bg-white shadow-sm p-5 dark:bg-slate-900">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{summary}</p>

        {/* Adjustments Nested Card */}
        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            {t("done.adjustmentsTitle")}
          </p>
          <ul className="space-y-2">
            {adjustments.map((adjustment, idx) => (
              <li key={idx} className="flex gap-3 text-sm text-slate-700 dark:text-slate-300">
                <span className="mt-1.5 flex-shrink-0 h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                <span>{adjustment}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Button Row */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onBack}
          className="rounded-2xl bg-slate-100 px-4 py-4 font-semibold text-slate-900 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          {t("done.backHome")}
        </button>
        <button
          onClick={handleContinueChat}
          className="rounded-2xl bg-slate-900 px-4 py-4 font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600"
        >
          {t("done.continueChat")}
        </button>
      </div>

      {/* Chat Input */}
      {showChat && (
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/50">
          {/* Chat History */}
          {chatMessages.length > 0 && (
            <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex gap-2 text-sm",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 max-w-xs",
                      msg.role === "user"
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="flex gap-2 text-sm justify-start">
                  <div className="rounded-lg px-3 py-2 bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100">
                    <span className="text-xs opacity-60">Loading...</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={t("done.chatPlaceholder")}
              disabled={isSending}
              className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || isSending}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
