"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, Activity, Target, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/home", icon: Home, key: "home" as const },
  { href: "/workouts", icon: Activity, key: "workouts" as const },
  { href: "/goals", icon: Target, key: "goals" as const },
  { href: "/analytics", icon: BarChart3, key: "analytics" as const },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <nav
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t bg-background/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-4">
        {TABS.map(({ href, icon: Icon, key }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={key}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-3 text-xs",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span>{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
