/**
 * GET /api/auth/google-fit/callback
 * Handles the Google OAuth callback, exchanges the code for tokens,
 * and stores them in oauth_tokens. Triggers cold-start on first connect.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { oauthTokens, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/api/auth/signin", process.env.NEXTAUTH_URL!));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/settings?fit_error=${error ?? "no_code"}`,
    );
  }

  const clientId = process.env.GOOGLE_FIT_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_FIT_CLIENT_SECRET!;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/google-fit/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("Google token exchange failed:", err);
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/settings?fit_error=token_exchange`);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  // Look up the user
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) });
  if (!user) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/settings?fit_error=user_not_found`);
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  const scopes = tokenData.scope.split(" ");

  // Upsert token row
  const existing = await db.query.oauthTokens.findFirst({
    where: (t, { and }) => and(eq(t.userId, user.id), eq(t.provider, "google_fit")),
  });
  const isFirstConnect = !existing;

  await db
    .insert(oauthTokens)
    .values({
      userId: user.id,
      provider: "google_fit",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scopes,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scopes,
        status: "active",
        updatedAt: new Date(),
      },
    });

  // Trigger initial sync (non-blocking — fire and forget)
  const syncUrl = `${process.env.NEXTAUTH_URL}/api/fit/sync`;
  fetch(syncUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.CRON_SECRET ?? "",
    },
    body: JSON.stringify({ userId: user.id, coldStart: isFirstConnect }),
  }).catch((e) => console.error("Background sync trigger failed:", e));

  return NextResponse.redirect(
    `${process.env.NEXTAUTH_URL}/settings?fit_connected=1`,
  );
}
