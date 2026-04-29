import { redirect } from "next/navigation";

// Goals tab removed in Phase 1 — goal management moved to Settings
export default function GoalsPage() {
  redirect("/settings");
}
