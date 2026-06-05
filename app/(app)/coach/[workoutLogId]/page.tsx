/**
 * THIS FILE AND ITS DIRECTORY MUST BE DELETED BEFORE BUILD.
 *
 * Replaced by app/(app)/coach/[threadId]/page.tsx (multi-thread refactor 0007).
 * Two `[param]` directories at the same path level make Next.js error out at
 * build time, so this directory has to be physically removed.
 *
 * The cowork bash sandbox couldn't delete files under OneDrive — Eran needs
 * to run this once locally before `pnpm typecheck` / `pnpm build`:
 *
 *   Remove-Item "app/(app)/coach/[workoutLogId]" -Recurse -Force
 *
 * The default export below is a harmless stub kept only so any IDE that
 * lints the file before cleanup doesn't choke on "no default export".
 */
export default function DeprecatedCoachWorkoutLogIdPage() {
  return null;
}
