/**
 * Sign-in allowlist. Fails closed in production: with ALLOWED_EMAIL unset,
 * nobody can sign in (any Google account would otherwise get the app and
 * unmetered Gemini). Outside production an unset allowlist stays open for dev.
 * ALLOWED_EMAIL may hold several addresses separated by commas.
 */
export function isEmailAllowed(
  email: string | null | undefined,
  allowedEnv: string | undefined = process.env.ALLOWED_EMAIL,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  const allowed = (allowedEnv ?? "")
    .split(",")
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
  if (allowed.length === 0) {
    if (nodeEnv === "production") {
      console.error("[auth] ALLOWED_EMAIL is not set: refusing every sign-in (fail closed)");
      return false;
    }
    return true;
  }
  const e = (email ?? "").toLowerCase().trim();
  return e !== "" && allowed.includes(e);
}
