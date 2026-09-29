import { describe, it, expect } from "vitest";
import { isLeakedToolText, parseLeakedToolCalls } from "@/lib/coach/leakedToolCalls";

// Verbatim shape of the prod reply from 2026-09-29 10:16:57 (from Eran's screenshot).
const PROD_LEAK = `tool_code
print(default_api.classifySession(sessionId='e3b663ba-6030-49e4-85dc-7b44bed38eb8', classification='activity'))
print(default_api.proposeSwapToRest(sessionId='36536f12-7d0c-4248-899d-8faeb43e6628', reason='Eran Ganot is returning to running after a break and needs an easier session today.'))
print(default_api.proposeAddSession(targetDate='2026-09-29', title='Easy Return to Running', distanceKm=2.0, paceSecPerKm=510, reason='Eran Ganot is returning to running after a break and needs an easy session today.'))
thought
The user has clarified that the session on September 26th was an activity, not training.
For the new easy run, a distance of 2 km at a pace of 8:30/km (510 seconds/km) seems appropriate.The 22-minute session on September 26th has been classified as general activity, Eran Ganot.`;

const ALLOWED = new Set(["classifySession", "proposeSwapToRest", "proposeAddSession", "proposeSoftenSession"]);

describe("leaked tool-call text", () => {
  it("detects the prod leak", () => {
    expect(isLeakedToolText(PROD_LEAK)).toBe(true);
  });

  it("does not flag normal coaching replies", () => {
    expect(isLeakedToolText("Easy 2 km at conversational pace today, Eran. I thought about your foot — keep pain ≤ 3.")).toBe(false);
    expect(isLeakedToolText("")).toBe(false);
  });

  it("salvages all three calls with typed args", () => {
    const calls = parseLeakedToolCalls(PROD_LEAK, ALLOWED);
    expect(calls.map((c) => c.name)).toEqual(["classifySession", "proposeSwapToRest", "proposeAddSession"]);
    expect(calls[0].args).toEqual({ sessionId: "e3b663ba-6030-49e4-85dc-7b44bed38eb8", classification: "activity" });
    expect(calls[2].args.distanceKm).toBe(2);
    expect(calls[2].args.paceSecPerKm).toBe(510);
    expect(calls[2].args.targetDate).toBe("2026-09-29");
  });

  it("ignores tool names that are not declared", () => {
    const calls = parseLeakedToolCalls("print(default_api.deleteEverything(x='1'))", ALLOWED);
    expect(calls).toEqual([]);
  });

  it("skips malformed calls instead of guessing", () => {
    const calls = parseLeakedToolCalls("print(default_api.proposeSwapToRest(sessionId='abc", ALLOWED);
    expect(calls).toEqual([]);
  });
});
