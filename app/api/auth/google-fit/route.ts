/**
 * GET /api/auth/google-fit
 * Initiates the Google Fit OAuth dance.
 * Redirects the user to Google's consent screen.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const SCOPES = [
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.location.read",
  "https://www.googleapis.com/auth/fitness.heart_rate.read",
  "https://www.googleapis.com/auth/fitness.body.read",
].join(" ");

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/api/auth/signin", process.env.NEXTAUTH_URL!));
  }

  const clientId = process.env.GOOGLE_FIT_CLIENT_ID;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/google-fit/callback`;

  if (!clientId) {
    return NextResponse.json({ error: "Google Fit not configured" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri!,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // force refresh_token to be returned every time
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
