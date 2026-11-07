// Used by Railway healthcheck — keep cheap.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    timestamp: new Date().toISOString(),
  });
}
