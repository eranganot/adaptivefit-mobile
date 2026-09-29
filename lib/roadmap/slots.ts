// Slot bookkeeping for roadmap regeneration.
//
// regenerateRoadmapForUser deletes only its own pending 'auto' rows and then
// writes fresh Tue/Fri sessions. Rows that survive the delete (manual adds,
// coach proposals, completed/modified rows) already own their day — writing an
// auto session on top of them put two runs on one date (2026-09-29: a
// coach-proposed "Easy Return to Running" plus a regenerated 5 × 600 m).

export type Slot = { weekIndex: number; dayIndex: number };

export const slotKey = (s: Slot): string => `${s.weekIndex}:${s.dayIndex}`;

/** Drop candidate sessions whose (weekIndex, dayIndex) is already taken. */
export function withoutOccupiedSlots<T extends Slot>(candidates: T[], occupied: Iterable<Slot>): T[] {
  const taken = new Set<string>();
  for (const s of occupied) taken.add(slotKey(s));
  return candidates.filter((c) => !taken.has(slotKey(c)));
}
