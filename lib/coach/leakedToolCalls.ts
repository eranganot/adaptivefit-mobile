// Gemini 2.5 Flash sometimes writes its tool calls as TEXT instead of real
// functionCall parts — e.g.
//
//   tool_code
//   print(default_api.proposeAddSession(targetDate='2026-09-29', distanceKm=2.0, reason='…'))
//   thought
//   <internal reasoning>…
//
// Observed in prod 2026-09-29 10:16:57 (replyLength 1564, functionCallCount 0).
// Left alone, that text is (1) shown to the athlete verbatim, (2) replayed as a
// "model" history turn, which makes the NEXT turn execute the calls the athlete
// never saw as cards. This module detects the leak, salvages the calls into
// real function calls, and gives callers a way to keep it out of history.

export type SalvagedCall = { name: string; args: Record<string, unknown> };

const LEAK_MARKERS: RegExp[] = [
  /(^|\n)\s*tool_code\s*(\n|$)/,
  /\bdefault_api\.[A-Za-z_]\w*\s*\(/,
  /(^|\n)\s*thought\s*\n/,
];

/** True when a model reply contains text-form tool calls or leaked reasoning. */
export function isLeakedToolText(text: string): boolean {
  if (!text) return false;
  return LEAK_MARKERS.some((re) => re.test(text));
}

/** Placeholder used instead of leaked text when replaying history to the model. */
export const LEAKED_HISTORY_PLACEHOLDER =
  "(Proposed plan changes via tool calls — shown to the athlete as cards.)";

/**
 * Parse `default_api.<name>(k=v, …)` calls out of leaked text. Only names in
 * `allowed` are returned; anything unparseable is skipped (never guessed).
 */
export function parseLeakedToolCalls(text: string, allowed: ReadonlySet<string>): SalvagedCall[] {
  const out: SalvagedCall[] = [];
  const re = /default_api\.([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const parsed = parseKwargs(text, re.lastIndex);
    if (!parsed) continue;
    re.lastIndex = parsed.end;
    if (allowed.has(name)) out.push({ name, args: parsed.args });
  }
  return out;
}

// Parses `k=v, k2=v2)` starting at `pos` (just after the opening paren).
function parseKwargs(src: string, pos: number): { args: Record<string, unknown>; end: number } | null {
  const args: Record<string, unknown> = {};
  let i = pos;
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  skipWs();
  if (src[i] === ")") return { args, end: i + 1 };
  while (i < src.length) {
    skipWs();
    const keyMatch = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (!keyMatch) return null;
    const key = keyMatch[0];
    i += key.length;
    skipWs();
    if (src[i] !== "=") return null;
    i++;
    skipWs();
    const val = parseValue(src, i);
    if (!val) return null;
    args[key] = val.value;
    i = val.end;
    skipWs();
    if (src[i] === ",") { i++; continue; }
    if (src[i] === ")") return { args, end: i + 1 };
    return null;
  }
  return null;
}

function parseValue(src: string, i: number): { value: unknown; end: number } | null {
  const ch = src[i];
  if (ch === "'" || ch === '"') {
    let j = i + 1;
    let s = "";
    while (j < src.length && src[j] !== ch) {
      if (src[j] === "\\" && j + 1 < src.length) {
        const n = src[j + 1];
        s += n === "n" ? "\n" : n === "t" ? "\t" : n;
        j += 2;
      } else {
        s += src[j++];
      }
    }
    if (j >= src.length) return null;
    return { value: s, end: j + 1 };
  }
  const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
  if (num) return { value: Number(num[0]), end: i + num[0].length };
  const lit = /^(True|False|None|true|false|null)\b/.exec(src.slice(i));
  if (lit) {
    const v = lit[1].toLowerCase();
    return { value: v === "true" ? true : v === "false" ? false : null, end: i + lit[1].length };
  }
  return null;
}
