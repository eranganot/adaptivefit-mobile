"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, Map, BarChart3, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { href: "/home", icon: Home, key: "home" as const },
  { href: "/roadmap", icon: Map, key: "roadmap" as const },
  { href: "/coach", icon: MessageSquare, key: "coach" as const },
  { href: "/analytics", icon: BarChart3, key: "analytics" as const },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-4">
        {TABS.map(({ href, icon: Icon, key }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={key} className="relative flex justify-center">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 pb-3 pt-2 text-[10px] font-medium transition-colors",
                  active
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <span>{t(key)}</span>
              </Link>
              <AnimatePresence>
                {active && (
                  <motion.span
                    layoutId="nav-indicator"
                    className="absolute bottom-0 h-0.5 w-8 rounded-full bg-blue-600 dark:bg-blue-400"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
