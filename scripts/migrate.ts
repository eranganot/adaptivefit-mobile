/**
 * scripts/migrate.ts
 * Runs drizzle-kit push (schema sync) against the live DATABASE_URL.
 */
import { execSync } from "child_process";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌  DATABASE_URL is not set — skipping migration.");
  process.exit(0);
}

console.log("⏳  Pushing schema to database…");
try {
  execSync("npx drizzle-kit push", { stdio: "inherit" });
  console.log("✅  Schema up to date.");
} catch (err) {
  console.error("❌  Schema push failed:", err);
  process.exit(1);
}
