import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { workoutLogs, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { getChatThreads } from "@/app/(app)/home/actions";
import { ChatList } from "@/components/coach/ChatList";

export default async function CoachPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
  if (!user) redirect("/sign-in");

  // Most recent workout — used as the target for "New conversation" since the
  // chat is workout-scoped. If the user has no workouts, the button links to
  // /home so they can log one.
  const [threads, recentWorkout] = await Promise.all([
    getChatThreads(),
    db.query.workoutLogs.findFirst({
      where: eq(workoutLogs.userId, user.id),
      orderBy: [desc(workoutLogs.performedAt)],
    }),
  ]);

  const newChatHref = recentWorkout ? `/coach/${recentWorkout.id}` : "/home";
  const newChatLabel = recentWorkout
    ? "New conversation about your latest workout"
    : "Log a workout to start a conversation";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Coach</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Your conversation history with the AI coach
          </p>
        </div>
      </div>

      {/* New conversation entry — always visible at top */}
      <Link
        href={newChatHref}
        className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-4 text-white shadow-sm hover:from-indigo-600 hover:to-purple-700 transition-colors"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 flex-shrink-0">
          <Plus className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{newChatLabel}</p>
          <p className="text-xs opacity-80 mt-0.5">
            {recentWorkout
              ? "Pick up where you left off — or ask anything new."
              : "The coach grounds advice in your actual workout data."}
          </p>
        </div>
      </Link>

      <ChatList threads={threads} />
    </div>
  );
}
