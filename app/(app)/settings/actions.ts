"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, oauthTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setLocale(locale: "en" | "he") {
  try {
    const session = await auth();
    
    if (!session?.user?.email) {
      return { success: false, error: "Not authenticated" };
    }

    // Get user from DB by email
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, session.user.email))
      .limit(1);

    if (!user || user.length === 0) {
      return { success: false, error: "User not found" };
    }

    const userId = user[0].id;

    // Update user locale in database
    await db
      .update(users)
      .set({ locale })
      .where(eq(users.id, userId));

    // Set locale cookie
    const cookieStore = await cookies();
    cookieStore.set("locale", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    // Revalidate to reflect changes
    revalidatePath("/");

    return { success: true };
  } catch (error) {
    console.error("Error setting locale:", error);
    return { success: false, error: "Failed to update locale" };
  }
}

export async function disconnectGoogleFit(): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
    if (!user) return { success: false, error: "User not found" };

    // Attempt to revoke the token with Google (non-fatal)
    const tokenRow = await db.query.oauthTokens.findFirst({
      where: and(eq(oauthTokens.userId, user.id), eq(oauthTokens.provider, "google_fit")),
    });
    if (tokenRow) {
      fetch(`https://oauth2.googleapis.com/revoke?token=${tokenRow.accessToken}`, {
        method: "POST",
      }).catch(() => {});
    }

    await db
      .delete(oauthTokens)
      .where(and(eq(oauthTokens.userId, user.id), eq(oauthTokens.provider, "google_fit")));

    revalidatePath("/settings");
    return { success: true };
  } catch (e) {
    console.error("disconnectGoogleFit error:", e);
    return { success: false, error: "Failed to disconnect" };
  }
}

export async function syncGoogleFit(): Promise<{
  success: boolean;
  daysFetched?: number;
  error?: string;
}> {
  try {
    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Not authenticated" };

    const res = await fetch(`${process.env.NEXTAUTH_URL}/api/fit/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.CRON_SECRET ?? "",
        Cookie: `next-auth.session-token=${session}`, // pass session forward
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) return { success: false, error: "Sync request failed" };
    const data = await res.json() as { daysFetched?: number };
    revalidatePath("/settings");
    return { success: true, daysFetched: data.daysFetched ?? 0 };
  } catch (e) {
    console.error("syncGoogleFit error:", e);
    return { success: false, error: "Failed to sync" };
  }
}
