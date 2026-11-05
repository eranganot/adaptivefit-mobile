import { describe, expect, it } from "vitest";
import { isEmailAllowed } from "@/lib/auth/allowlist";

describe("isEmailAllowed", () => {
  it("fails closed in production when ALLOWED_EMAIL is unset or blank", () => {
    expect(isEmailAllowed("eran@example.com", undefined, "production")).toBe(false);
    expect(isEmailAllowed("eran@example.com", "  ", "production")).toBe(false);
  });
  it("stays open outside production when unset (dev)", () => {
    expect(isEmailAllowed("anyone@example.com", undefined, "development")).toBe(true);
  });
  it("matches case- and space-insensitively", () => {
    expect(isEmailAllowed("Eran@Example.com ", "eran@example.com", "production")).toBe(true);
  });
  it("refuses other and missing emails", () => {
    expect(isEmailAllowed("other@example.com", "eran@example.com", "production")).toBe(false);
    expect(isEmailAllowed(undefined, "eran@example.com", "production")).toBe(false);
    expect(isEmailAllowed("", "eran@example.com", "production")).toBe(false);
  });
  it("accepts a comma-separated list", () => {
    expect(isEmailAllowed("b@x.com", "a@x.com, b@x.com", "production")).toBe(true);
  });
});
