import { describe, it, expect } from "vitest";
import { withoutOccupiedSlots } from "@/lib/roadmap/slots";

describe("withoutOccupiedSlots", () => {
  it("skips a regenerated Tuesday when a coach-proposed session already owns it", () => {
    const candidates = [
      { weekIndex: 0, dayIndex: 2, title: "5 × 600 m" },
      { weekIndex: 0, dayIndex: 5, title: "Fri endurance" },
      { weekIndex: 1, dayIndex: 2, title: "Tue W1" },
    ];
    const surviving = [{ weekIndex: 0, dayIndex: 2 }]; // Easy Return to Running
    expect(withoutOccupiedSlots(candidates, surviving).map((c) => c.title)).toEqual(["Fri endurance", "Tue W1"]);
  });

  it("keeps everything when nothing survived", () => {
    const candidates = [{ weekIndex: 0, dayIndex: 2 }, { weekIndex: 0, dayIndex: 5 }];
    expect(withoutOccupiedSlots(candidates, [])).toHaveLength(2);
  });

  it("does not confuse the same weekday in a different week", () => {
    expect(withoutOccupiedSlots([{ weekIndex: 1, dayIndex: 2 }], [{ weekIndex: 0, dayIndex: 2 }])).toHaveLength(1);
  });
});
