/**
 * Retry-with-backoff tests + describeGeminiError category mapping.
 *
 * The retry helper protects every chat coach call from transient Gemini
 * failures. Pinning the contract here so we never regress to "single network
 * blip = whole coach turn fails."
 */
import { describe, expect, it, vi } from "vitest";
import { withGeminiRetry, describeGeminiError } from "@/lib/gemini/retry";

describe("withGeminiRetry", () => {
  it("returns the result on first success — no retry", async () => {
    const fn = vi.fn().mockResolvedValueOnce("ok");
    const result = await withGeminiRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and returns success on second attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValueOnce("ok");
    const result = await withGeminiRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries up to maxAttempts then throws the last error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("503 Service Unavailable"));
    await expect(
      withGeminiRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on terminal errors (bad API key)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("API key not valid"));
    await expect(withGeminiRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("API key");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on invalid argument (bad tool schema)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("INVALID_ARGUMENT: Invalid value at 'tools[0]'"));
    await expect(withGeminiRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("INVALID_ARGUMENT");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on auth errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("401 Unauthorized"));
    await expect(withGeminiRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on rate-limit errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests — RESOURCE_EXHAUSTED"))
      .mockResolvedValueOnce("ok");
    const result = await withGeminiRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on network errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"))
      .mockResolvedValueOnce("ok");
    const result = await withGeminiRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry callback with attempt number + error", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce("ok");
    await withGeminiRetry(fn, { baseDelayMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });
});

describe("describeGeminiError", () => {
  it("rate limit → friendly retry-soon message", () => {
    const r = describeGeminiError(new Error("429 RESOURCE_EXHAUSTED rate limit"));
    expect(r.category).toBe("rate_limit");
    expect(r.userMessage).toContain("rate-limited");
  });

  it("context too large → suggest fresh thread", () => {
    const r = describeGeminiError(new Error("INVALID_ARGUMENT: request payload size exceeds limit"));
    expect(r.category).toBe("context_too_large");
    expect(r.userMessage).toContain("conversation got too long");
  });

  it("503 → service unavailable", () => {
    const r = describeGeminiError(new Error("503 Service Unavailable"));
    expect(r.category).toBe("service_unavailable");
    expect(r.userMessage).toContain("having a moment");
  });

  it("auth failure → check API key", () => {
    const r = describeGeminiError(new Error("API key not valid"));
    expect(r.category).toBe("auth");
    expect(r.userMessage).toContain("API key");
  });

  it("network error → check connection", () => {
    const r = describeGeminiError(new Error("fetch failed: ECONNRESET"));
    expect(r.category).toBe("network");
    expect(r.userMessage).toContain("connection");
  });

  it("unknown errors get a generic fallback with the actual message", () => {
    const r = describeGeminiError(new Error("Something weird happened"));
    expect(r.category).toBe("unknown");
    expect(r.userMessage).toContain("Something weird happened");
  });
});
