import { getChatThreads } from "@/app/(app)/home/actions";
import { ChatList } from "@/components/coach/ChatList";

export default async function CoachPage() {
  const threads = await getChatThreads();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Coach</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your conversation history with the AI coach
        </p>
      </div>
      <ChatList threads={threads} />
    </div>
  );
}
