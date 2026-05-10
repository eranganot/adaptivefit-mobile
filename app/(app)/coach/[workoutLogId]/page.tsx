import { getChatHistory } from "@/app/(app)/home/actions";
import { getActionsForThread } from "@/app/(app)/coach/actions";
import { ChatThread } from "@/components/coach/ChatThread";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ workoutLogId: string }>;
}

export default async function CoachThreadPage({ params }: PageProps) {
  const { workoutLogId } = await params;

  if (!workoutLogId || workoutLogId.length < 10) notFound();

  const [messages, actions] = await Promise.all([
    getChatHistory(workoutLogId, 40),
    getActionsForThread(workoutLogId),
  ]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pb-24">
      <ChatThread
        workoutLogId={workoutLogId}
        initialMessages={messages}
        initialActions={actions}
      />
    </div>
  );
}
