import { redirect } from "next/navigation";

// Workouts tab removed in Phase 1 — logging is now part of the Home flow
export default function WorkoutsPage() {
  redirect("/home");
}
