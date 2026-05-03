import { notFound } from "next/navigation";

// Route removed — goal management lives in Settings.
// Returning 404 so no stale link silently succeeds.
export default function GoalsPage() {
  notFound();
}
