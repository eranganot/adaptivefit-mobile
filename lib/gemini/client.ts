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
// 2.5 series. Override via GEMINI_MODEL_FAST / GEMINI_MODEL_DEEP env vars when
// new generations land. Production must also update the Railway env vars.
export const MODELS = {
  FAST: process.env.GEMINI_MODEL_FAST ?? "gemini-2.5-flash",
  DEEP: process.env.GEMINI_MODEL_DEEP ?? "gemini-2.5-pro",
};
