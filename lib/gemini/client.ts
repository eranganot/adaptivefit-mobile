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

export const MODELS = {
  FAST: process.env.GEMINI_MODEL_FAST ?? "gemini-1.5-flash",
  DEEP: process.env.GEMINI_MODEL_DEEP ?? "gemini-1.5-pro",
};
