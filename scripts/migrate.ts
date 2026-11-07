/**
 * scripts/migrate.ts
 *
 * Non-interactive migration runner. Replaces `drizzle-kit push` (which prompts
 * interactively and silently fails in CI / Railway non-TTY environments).
 *
 * Reads all .sql files from ./drizzle/ in alphabetical order and applies the ones
 * not yet recorded in the _migrations journal (AF-6). Each SQL file MUST still be idempotent (use ADD COLUMN IF NOT
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
import { createHash } from "crypto";
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

  // AF-6 (2026-11-05): a journal. Every file used to run on every deploy, so a
  // data backfill (0005) re-ran each time and old files were edited in place
  // to change behaviour. Now each file runs once, in its own transaction, and
  // is recorded with a checksum. The first deploy with this runner re-applies
  // every file one last time (they are all idempotent) and records them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const applied = new Map<string, string>(
    (await pool.query<{ name: string; checksum: string }>("SELECT name, checksum FROM _migrations")).rows.map(
      (r) => [r.name, r.checksum],
    ),
  );

  let ran = 0;
  console.log(`⏳  ${files.length} migration file(s), ${applied.size} already applied…`);
  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(path, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prior = applied.get(file);
    if (prior !== undefined) {
      if (prior !== checksum) {
        // Not fatal (a deploy must not die on a comment edit), but loud: an
        // applied migration is history. Change behaviour in a NEW file.
        console.warn(`   ⚠ ${file} changed after it was applied - NOT re-run. Put the change in a new file.`);
      }
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
      await client.query("COMMIT");
      ran += 1;
      console.log(`   ✓ ${file}`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`   ✗ ${file}:`, err);
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }
  console.log(`   ${ran} applied this run.`);
  console.log("✅  All migrations applied.");
  await pool.end();
})();
