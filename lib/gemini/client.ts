/**
 * Gemini client — server-only.
 * Throws on missing key, but lazily, so dev environments without a key can still type-check.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

let _client: GoogleGenerativeAI | null = null;

export function gemini(): GoogleGenerativeAI {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/app/apikey");
  }
  _client = new GoogleGenerativeAI(key);
  return _client;
}

// Model defaults: gemini-1.5-* was deprecated by Google. We default to the
// 2.5 series. Override via env vars when new generations land or when you
// need to flip a tier without a code push (Railway Variables → redeploy).
//
// Tier purposes:
//   FAST  — extractFeedback, summarizePostWorkout, summarizeCoachContext (the
//           pre-step). Cheap, fast, sufficient for compression/extraction.
//   DEEP  — cold-start importer (one-shot, complex reasoning, batch-style).
//   CHAT  — the conversational coach. Defaults to FAST because Pro's
//           thinking-token accounting on SDK v0.21 caused empty responses,
//           and Pro's free-tier daily quota (~50/day) gets exhausted
//           quickly in active testing. Flip to "gemini-2.5-pro" via Railway
//           env when you've enabled billing OR upgraded the SDK.
export const MODELS = {
  FAST: process.env.GEMINI_MODEL_FAST ?? "gemini-2.5-flash",
  DEEP: process.env.GEMINI_MODEL_DEEP ?? "gemini-2.5-pro",
  CHAT: process.env.GEMINI_MODEL_CHAT ?? "gemini-2.5-flash",
};
