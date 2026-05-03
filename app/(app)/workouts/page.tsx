import { notFound } from "next/navigation";

// Route removed — workout logging lives in the Home flow.
// Returning 404 so no stale link silently succeeds.
export default function WorkoutsPage() {
  notFound();
}
