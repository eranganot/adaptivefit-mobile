import { getChatThreads } from "@/app/(app)/home/actions";
import { ChatList } from "@/components/coach/ChatList";

export default async function CoachPage() {
  const threads = await getChatThreads();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pb-24">
      <div className="max-w-md mx-auto px-4 pt-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Coach</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">
            Your conversation history with the AI coach
          </p>
        </div>
        <ChatList threads={threads} />
      </div>
    </div>
  );
}
