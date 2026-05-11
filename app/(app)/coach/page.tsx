import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { workoutLogs, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { Plus, MessageSquare } from "lucide-react";
import { getChatThreads } from "@/app/(app)/home/actions";
import { ChatList } from "@/components/coach/ChatList";

export default async function CoachPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
  if (!user) redirect("/sign-in");

  const [threads, recentWorkout] = await Promise.all([
    getChatThreads(),
    db.query.workoutLogs.findFirst({
      where: eq(workoutLogs.userId, user.id),
      orderBy: [desc(workoutLogs.performedAt)],
    }),
  ]);

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

      {/* PRIMARY: New conversation — a fresh general thread (no specific workout).
          Maps to /coach/general which is a sentinel handled server-side. */}
      <Link
        href="/coach/general"
        className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-4 text-white shadow-sm hover:from-indigo-600 hover:to-purple-700 transition-colors"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 flex-shrink-0">
          <Plus className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Start a new conversation</p>
          <p className="text-xs opacity-80 mt-0.5">
            Ask anything — training, recovery, planning, gear.
          </p>
        </div>
      </Link>

      {/* SECONDARY: shortcut to chat about the latest workout. */}
      {recentWorkout && (
        <Link
          href={`/coach/${recentWorkout.id}`}
          className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex-shrink-0">
            <MessageSquare className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Chat about your latest workout</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Discuss the specific session and let the coach reference its data.
            </p>
          </div>
        </Link>
      )}

      <ChatList threads={threads} />
    </div>
  );
}
