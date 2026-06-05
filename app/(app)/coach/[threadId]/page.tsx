/**
 * /coach/[threadId] — the chat UI itself.
 *
 * Threads are the source of truth for chat history (post-0007). The URL slug
 * is the coach_threads.id UUID. Workout-debrief threads carry a non-null
 * workout_log_id on their row; general threads don't. The page doesn't need
 * to know the difference — ChatThread loads everything from the thread row.
 *
 * Legacy redirects:
 *   - /coach/general              → /coach/new   (creates a fresh general thread)
 *   - /coach/<workout-log-uuid>   → /coach/<thread-id> for that workout
 *     (resolved by looking up the existing thread or creating one)
 *
 * These let any bookmarks / browser-history entries from before the refactor
 * keep working without 404ing.
 */
import { getChatHistory } from "@/app/(app)/home/actions";
import { getActionsForThread } from "@/app/(app)/coach/actions";
import { ChatThread } from "@/components/coach/ChatThread";
import { getThread, getOrCreateWorkoutThread } from "@/lib/coach/threads";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, workoutLogs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ threadId: string }>;
}

// Permissive UUID check — matches Postgres's gen_random_uuid() output (v4)
// plus the v7/v8 shapes some Drizzle versions emit. We don't strictly validate
// the version nibble because that's not the layer of concern; we just want to
// avoid running redirect logic for obvious garbage like "favicon.ico".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CoachThreadPage({ params }: PageProps) {
  const { threadId: slug } = await params;
  if (!slug) notFound();

  // ── Legacy slug: "general" ──────────────────────────────────────────
  // Old URL shape from before multi-thread support. Send the user to /coach/new
  // which creates a fresh general thread on each visit. Matches the new mental
  // model of "Start a new conversation".
  if (slug === "general") {
    redirect("/coach/new");
  }

  // ── Anything that isn't a UUID → 404 ────────────────────────────────
  if (!UUID_RE.test(slug)) {
    notFound();
  }

  // Auth happens here (rather than only inside ChatThread's actions) because
  // we may need to do an ownership-scoped lookup against workouts for the
  // legacy redirect path below.
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");
  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) redirect("/sign-in");

  // ── Try the slug as a thread id first ───────────────────────────────
  const thread = await getThread(user.id, slug);

  // ── Legacy fallback: slug is a workout_log_id ───────────────────────
  // The pre-0007 URL shape pointed at a workout. If the slug matches one
  // of the user's workouts, find-or-create that workout's thread and
  // redirect there. Preserves bookmarks; future visits land on the new URL.
  if (!thread) {
    const workout = await db.query.workoutLogs.findFirst({
      where: and(eq(workoutLogs.id, slug), eq(workoutLogs.userId, user.id)),
      columns: { id: true },
    });
    if (workout) {
      const created = await getOrCreateWorkoutThread(user.id, workout.id);
      redirect(`/coach/${created.id}`);
    }
    notFound();
  }

  const [messages, actions] = await Promise.all([
    getChatHistory(thread.id, 40),
    getActionsForThread(thread.id),
  ]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 pb-24">
      <ChatThread
        threadId={thread.id}
        workoutLogId={thread.workoutLogId}
        initialMessages={messages}
        initialActions={actions}
      />
    </div>
  );
}
