import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { BottomNav } from "@/components/custom/BottomNav";
import { Settings } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const initials = session.user.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "AF";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-slate-50 dark:bg-slate-950">
      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white/80 px-4 backdrop-blur dark:bg-slate-950/80">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <span className="text-sm font-black italic leading-none text-white">AF</span>
          </div>
          <span className="text-base font-semibold tracking-tight">AdaptiveFit</span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            {initials}
          </div>
        </div>
      </header>

      {/* ── Page content ──────────────────────────────────────────────── */}
      <main className="flex-1 px-4 pb-28 pt-5">{children}</main>

      <BottomNav />
    </div>
  );
}
