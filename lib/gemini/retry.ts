/**
 * Retry-with-backoff for Gemini API calls.
 *
 * Most "Coach service is temporarily unavailable" errors trace to transient
 * Google issues (rate limits, brief 503s, network blips). The previous code
 * failed the whole chat turn on the first error, forcing the user to retap
 * send. This helper auto-recovers in the background.
 *
 * Retries on transient categories ONLY — terminal errors (bad API key,
 * malformed tool schema, request too large) throw immediately. Otherwise the
 * retry loop would waste latency on errors that won't fix themselves.
 *
 * Default policy: 3 attempts, 1s/2s/4s exponential backoff.
 */

export type GeminiRetryOptions = {
  /** Total attempts including the first try. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms; the Nth retry waits `baseDelayMs * 2 ^ (N-1)`. Default 1000. */
  baseDelayMs?: number;
  /** Optional callback for observability — fires on each retry attempt. */
  onRetry?: (attempt: number, lastError: unknown) => void;
};

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: GeminiRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Don't retry terminal errors — these won't fix themselves and
      // burning retries on them just adds latency before the inevitable
      // failure surfaces to the user.
      if (isPermanentError(msg)) throw err;

      // Out of retries — let the caller handle it.
      if (attempt === maxAttempts) throw err;

      options.onRetry?.(attempt, err);

      // Exponential backoff: 1s, 2s, 4s …
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  // Unreachable in practice (the loop either returns or throws), but TS
  // can't prove that.
  throw lastError;
}

/**
 * Classify an error message as terminal (don't retry) or transient (retry).
 *
 * Transient (RETRY): rate limit (429 / RESOURCE_EXHAUSTED), server error
 * (500 / INTERNAL), service unavailable (503 / UNAVAILABLE), timeout
 * (504 / DEADLINE_EXCEEDED), network errors (ECONNRESET, ETIMEDOUT,
 * "fetch failed", "socket hang up"), "model is overloaded".
 *
 * Terminal (NO RETRY): invalid request (400 / INVALID_ARGUMENT), bad auth
 * (401 / UNAUTHENTICATED), permission denied (403), schema rejection,
 * "API key" errors.
 *
 * When in doubt, retry — the cost of one extra retry on a terminal error
 * is small; the cost of failing fast on a transient error is the user
 * having to retap.
 */
function isPermanentError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("invalid argument") ||
    lower.includes("invalid_argument") ||
    lower.includes("invalid value at") ||
    lower.includes("permission denied") ||
    lower.includes("permission_denied") ||
    lower.includes("unauthenticated") ||
    lower.includes("api key") ||
    lower.includes("api_key") ||
    lower.includes("400 bad request") ||
    lower.includes("401 unauthorized") ||
    lower.includes("403 forbidden")
  );
}

/**
 * Extract a user-meaningful summary from a Gemini error for surfacing to
 * the chat UI. Maps known categories to short, plain-English explanations.
 * Unknown errors get a generic fallback.
 */
export function describeGeminiError(err: unknown): {
  category: "rate_limit" | "context_too_large" | "service_unavailable" | "auth" | "schema" | "network" | "unknown";
  userMessage: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("rate limit") || lower.includes("quota")) {
    return {
      category: "rate_limit",
      userMessage: "Coach is rate-limited by Gemini. Try again in a minute.",
    };
  }
  if (lower.includes("invalid argument") || lower.includes("payload size") || lower.includes("context") || lower.includes("token limit")) {
    return {
      category: "context_too_large",
      userMessage: "This conversation got too long for the coach. Start a fresh thread.",
    };
  }
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("overloaded")) {
    return {
      category: "service_unavailable",
      userMessage: "Gemini is having a moment. Try again shortly.",
    };
  }
  if (lower.includes("401") || lower.includes("unauthenticated") || lower.includes("api key")) {
    return {
      category: "auth",
      userMessage: "Coach auth is misconfigured. Check the Gemini API key.",
    };
  }
  if (lower.includes("invalid value at") || lower.includes("function_declarations")) {
    return {
      category: "schema",
      userMessage: "Coach tool schema rejected. This is a bug — please report.",
    };
  }
  if (lower.includes("fetch failed") || lower.includes("socket") || lower.includes("econnreset") || lower.includes("etimedout") || lower.includes("network")) {
    return {
      category: "network",
      userMessage: "Network hiccup reaching Gemini. Check your connection and retry.",
    };
  }
  return {
    category: "unknown",
    userMessage: `Coach failed: ${msg.slice(0, 200)}`,
  };
}
