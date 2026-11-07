import { sql } from "drizzle-orm";
import { db as rootDb, type Tx } from "@/lib/db";

/**
 * AF-B6: re-derive week_index / day_index from session_date for the current
 * week (Sunday anchor, UTC - see drizzle/0009_roadmap_session_date.sql).
 *
 * Call before reading a user's roadmap. One UPDATE that touches only rows whose
 * indexes are stale, so after the first call of a week it changes nothing.
 * Rows from past weeks get a negative week_index, which every reader already
 * filters out (week_index >= 0) - which is the point.
 */
export async function reanchorRoadmap(userId: string, db: Tx | typeof rootDb = rootDb): Promise<void> {
  await db.execute(sql`
    WITH a AS (SELECT af_week_sunday(now()) AS sun)
    UPDATE training_roadmap t
       SET week_index   = floor((t.session_date - a.sun) / 7.0)::int,
           day_index    = (((t.session_date - a.sun) % 7) + 7) % 7,
           session_date = t.session_date
      FROM a
     WHERE t.user_id = ${userId}
       AND t.session_date IS NOT NULL
       AND (t.week_index <> floor((t.session_date - a.sun) / 7.0)::int
            OR t.day_index <> (((t.session_date - a.sun) % 7) + 7) % 7)
  `);
}
