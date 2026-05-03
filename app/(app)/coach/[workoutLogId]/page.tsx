import { getChatHistory } from "@/app/(app)/home/actions";
import { ChatThread } from "@/components/coach/ChatThread";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ workoutLogId: string }>;
}

export default async function CoachThreadPage({ params }: PageProps) {
  const { workoutLogId } = await params;

  if (!workoutLogId || workoutLogId.length < 10) notFound();

  const messages = await getChatHistory(workoutLogId, 40);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pb-24">
      <ChatThread workoutLogId={workoutLogId} initialMessages={messages} />
    </div>
  );
}
