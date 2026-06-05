/**
 * /coach — landing page that lists chat threads.
 *
 * Two CTAs at the top:
 *   1. "Start a new conversation" — form POSTs to /coach/new, which
 *      creates a fresh coach_threads row and redirects. Guarantees an
 *      empty UI on every click. Each click = new row = new URL.
 *   2. "Chat about your latest workout" — server-resolves the user's
 *      latest workout to its (find-or-create) workout-debrief thread,
 *      then a plain <Link> sends them there.
 *
 * Below: ChatList showing every existing thread (both general and
 * workout-debrief), newest-active-first.
 */
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { workoutLogs, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { Plus, MessageSquare } from "lucide-react";
import { getChatThreads } from "@/app/(app)/home/actions";
import { ChatList } from "@/components/coach/ChatList";
import { getOrCreateWorkoutThread } from "@/lib/coach/threads";

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

  // Resolve the workout-debrief thread for the latest workout up-front so the
  // CTA can be a plain anchor (no extra round-trip). This either returns the
  // existing thread or creates one — idempotent and cheap.
  let latestWorkoutThreadHref: string | null = null;
  if (recentWorkout) {
    try {
      const { id } = await getOrCreateWorkoutThread(user.id, recentWorkout.id);
      latestWorkoutThreadHref = `/coach/${id}`;
    } catch (err) {
      console.warn("[CoachPage] getOrCreateWorkoutThread failed:", err);
    }
  }

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

      {/* PRIMARY: Start a new conversation. Form POSTs to /coach/new which
          inserts a fresh coach_threads row and redirects — guarantees a fresh
          UI on every click (the whole point of the multi-thread refactor). */}
      <form action="/coach/new" method="POST">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-4 text-left text-white shadow-sm hover:from-indigo-600 hover:to-purple-700 transition-colors"
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
        </button>
      </form>

      {/* SECONDARY: shortcut to the latest workout's debrief thread. */}
      {latestWorkoutThreadHref && (
        <Link
          href={latestWorkoutThreadHref}
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
