/**
 * scripts/migrate.ts
 *
 * Non-interactive migration runner. Replaces `drizzle-kit push` (which prompts
 * interactively and silently fails in CI / Railway non-TTY environments).
 *
 * Reads all .sql files from ./drizzle/ in alphabetical order and executes them
 * against DATABASE_URL. Each SQL file MUST be idempotent (use ADD COLUMN IF NOT
 * EXISTS, CREATE TABLE IF NOT EXISTS, etc.) so re-running is always safe — even
 * on every deploy.
 *
 * Why idempotent + always-run instead of journal-based?
 * - Journal-based migration on an existing DB requires a careful "mark as
 *   applied" bootstrap. We don't want that footgun on Railway.
 * - Idempotent SQL is bulletproof: re-running ALTER TABLE IF NOT EXISTS adds
 *   no work and no risk.
 *
 * To add a new migration: drop a numbered .sql file in ./drizzle/ (e.g.
 * 0002_add_foo.sql). Use IF NOT EXISTS / IF EXISTS guards so it's idempotent.
 */
import "dotenv/config";
import { Pool } from "pg";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌  DATABASE_URL is not set — cannot run migrations.");
  process.exit(1);
}

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

(async () => {
  const pool = new Pool({ connectionString: url });

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch (err) {
    console.error("❌  Could not read migrations directory:", err);
    await pool.end();
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("ℹ️   No migration files found in ./drizzle — nothing to do.");
    await pool.end();
    return;
  }

  console.log(`⏳  Applying ${files.length} migration file(s) (idempotent)…`);
  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(path, "utf8");
    try {
      await pool.query(sql);
      console.log(`   ✓ ${file}`);
    } catch (err) {
      console.error(`   ✗ ${file}:`, err);
      await pool.end();
      process.exit(1);
    }
  }
  console.log("✅  All migrations applied.");
  await pool.end();
})();
