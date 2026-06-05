/**
 * POST /coach/new — create a fresh general thread + redirect to it.
 *
 * Wired to the "Start a new conversation" button on /coach. Each click
 * inserts a brand-new coach_threads row (workout_log_id=NULL) and bounces
 * the user to /coach/<new-thread-id> so they land on an empty UI.
 *
 * Why a route handler instead of a Link?
 *   - A Link would need a stable href, which would force us to either re-use
 *     the same general thread every time (defeats the whole purpose) or
 *     generate ids client-side (won't satisfy the coach_threads FK).
 *   - A server action invoked from a <form action> handles both: server
 *     generates the id, server redirects, no client-side UUID work.
 *
 * GET also returns a new thread so old browser-history entries pointing at
 * /coach/general (which now redirect here from [threadId]/page.tsx) still
 * "do the right thing".
 */
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { createGeneralThread } from "@/lib/coach/threads";

async function createAndRedirect(): Promise<never> {
  const session = await auth();
  if (!session?.user?.email) redirect("/sign-in");

  const user = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
  });
  if (!user) redirect("/sign-in");

  const { id } = await createGeneralThread(user.id);
  redirect(`/coach/${id}`);
}

export async function POST() {
  await createAndRedirect();
}

export async function GET() {
  await createAndRedirect();
}
