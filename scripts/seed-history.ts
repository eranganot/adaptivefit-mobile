/**
 * seed-history.ts
 *
 * Seeds the DB with Eran's real workout history extracted from Gemini chat.
 * Run with:  pnpm tsx scripts/seed-history.ts
 *
 * Idempotent: skips if workoutLogs already exist for this user.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../lib/db/schema";
import { eq } from "drizzle-orm";

// ── DB ────────────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const db = drizzle(pool, { schema });

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(n: number, hour = 8): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function minToSec(min: number): number {
  return Math.round(min * 60);
}

// ── Workout history data ──────────────────────────────────────────────────────
// Extracted from Gemini coaching chats (תוכנית-ריצה-למתחילים + אימון-ריצה-עם-מתח)
// Dates are estimated relative to today (2026-04-27) based on conversation flow

const HISTORY: Array<{
  performedAt: Date;
  type: "run" | "strength" | "mobility" | "other";
  distanceKm?: number;
  durationMin?: number;
  rpe: number;
  footPain: number;
  otherPain?: string;
  notesRaw: string;
  notesLocale: "en" | "he";
  sentiment: {
    overallSentiment: "positive" | "neutral" | "concern";
    symptoms: string[];
    severity: number;
    aiSummaryEn: string;
    aiSummaryHe: string;
  };
}> = [
  // ── Session 1: First comeback run ─────────────────────────────────────────
  // 3km at ~7:00/km, both breathing difficulty and foot pain
  {
    performedAt: daysAgo(42, 8),
    type: "run",
    distanceKm: 3.0,
    durationMin: 21,
    rpe: 8,
    footPain: 6,
    notesRaw:
      "חזרה ראשונה לריצה אחרי הפסקה של שנתיים. 3 ק\"מ בקצב 7:00. קושי בנשימה וכאבים בכפות הרגליים. עמדתי בזה.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "concern",
      symptoms: ["foot_pain", "breathlessness"],
      severity: 6,
      aiSummaryEn:
        "First run back after 2+ years. Completed 3km at 7:00 pace. Significant foot pain and breathing difficulty — classic signs of returning after a long break. Reduce pace and try run-walk intervals next time.",
      aiSummaryHe:
        "חזרה ראשונה לריצה אחרי הפסקה ארוכה. 3 ק\"מ ב-7:00. כאבים בכפות רגליים וקשיי נשימה. כדאי להוריד קצב ולנסות שיטת ריצה-הליכה.",
    },
  },

  // ── Session 2: First intervals (4 × 500m) ────────────────────────────────
  // 2km intervals total, started very fast ~5:35 then dropped due to foot pain
  {
    performedAt: daysAgo(38, 7),
    type: "run",
    distanceKm: 2.2,
    durationMin: 22,
    rpe: 8,
    footPain: 5,
    notesRaw:
      "4 אינטרוולים של 500 מטר. התחלתי חזק מדי (5:35), ירדתי בקצב. כפות הרגליים כאבו בקמ' השני. נעלי NB Tempus.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "concern",
      symptoms: ["foot_pain", "arch_pain"],
      severity: 5,
      aiSummaryEn:
        "4 × 500m intervals. Started too fast at 5:35 pace, then dropped significantly. Foot arch pain appeared at km 2. New Balance Tempus shoes — too rigid for this phase of return to running.",
      aiSummaryHe:
        "4 אינטרוולים של 500 מטר. התחלה מהירה מדי, כאב בקשת הרגל בקמ' 2. נעלי NB Tempus — קשות מדי לשלב החזרה לריצה.",
    },
  },

  // ── Session 3: Strength (first dedicated session) ─────────────────────────
  {
    performedAt: daysAgo(36, 9),
    type: "strength",
    durationMin: 25,
    rpe: 6,
    footPain: 0,
    notesRaw:
      "אימון כוח - פלג גוף עליון וליבה. שכיבות סמיכה, פלאנק, כפיפות בטן. אין עומס על הרגליים.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "positive",
      symptoms: [],
      severity: 0,
      aiSummaryEn:
        "Upper body + core session: push-ups, plank, crunches. Zero foot load — smart choice while recovering from arch pain.",
      aiSummaryHe:
        "אימון פלג גוף עליון וליבה: שכיבות סמיכה, פלאנק, כפיפות בטן. אפס עומס על הרגליים — בחירה נכונה בזמן ההחלמה.",
    },
  },

  // ── Session 4: 4 × 850m intervals ────────────────────────────────────────
  // ~4km total, arch pain in last interval, still with NB Tempus
  {
    performedAt: daysAgo(33, 7),
    type: "run",
    distanceKm: 3.95,
    durationMin: 38,
    rpe: 7,
    footPain: 4,
    notesRaw:
      "4 אינטרוולים של 850 מטר עם 90 שניות הליכה. חימום 5 דק'. האימון לא היה קשה, אך באינטרוול האחרון כאב לחץ בקשת כף הרגל. נעלי NB Tempus.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "neutral",
      symptoms: ["arch_pain"],
      severity: 4,
      aiSummaryEn:
        "4 × 850m with 90s walk recoveries. Aerobic effort was manageable, but arch pressure returned in the last interval. Confirmed: NB Tempus shoes are too rigid — time to switch to neutral max-cushion.",
      aiSummaryHe:
        "4 × 850 מטר עם 90 שניות הליכה. מאמץ אירובי סביר, אך לחץ בקשת באינטרוול האחרון. NB Tempus — קשות מדי, הגיע הזמן לעבור לנעל נייטרלית.",
    },
  },

  // ── Session 5: 6 × 600m — first run in Mizuno Wave Rider 29 ──────────────
  // 5km in 32 min, sharp foot pain after removing shoes
  {
    performedAt: daysAgo(30, 7),
    type: "run",
    distanceKm: 5.0,
    durationMin: 32,
    rpe: 8,
    footPain: 7,
    notesRaw:
      "6 אינטרוולים של 600 מטר + 150 מטר הליכה + 15 דקות הליכה. חימום 10 דק'. ניסיון ראשון עם Mizuno Wave Rider 29. האינטרוולים 3-4 היו הקשים ביותר, אחר כך נכנסתי לקצב. כאבים חדים בכפות הרגליים אחרי החליצה.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "concern",
      symptoms: ["arch_pain", "foot_pain", "metatarsalgia"],
      severity: 7,
      aiSummaryEn:
        "First run in Mizuno Wave Rider 29. 6 × 600m + 15min walk. 5km total in 32min. Breathing improved — entered a rhythm after intervals 3-4. Sharp arch and metatarsal pain after removing shoes. Too much volume too soon with new shoes.",
      aiSummaryHe:
        "ריצה ראשונה עם Mizuno Wave Rider 29. 6 × 600 + 15 דק' הליכה. 5 ק\"מ ב-32 דק'. הנשימה השתפרה. כאבים חדים בקשת ובכריות לאחר חליצת הנעליים — נפח גדול מדי עם נעל חדשה.",
    },
  },

  // ── Session 6: Recovery run — 2km test ───────────────────────────────────
  {
    performedAt: daysAgo(27, 7),
    type: "run",
    distanceKm: 2.0,
    durationMin: 14,
    rpe: 5,
    footPain: 2,
    notesRaw:
      "ריצת מבחן אחרי מנוחה. 2 ק\"מ בקצב 6:55. חימום 10 דק'. ב-500 המטרים האחרונים הרגשתי את הכאב חוזר אך לא בצורה דרמטית. מסקנה: 2 ק\"מ הוא הרף הנוכחי.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "neutral",
      symptoms: ["arch_pain"],
      severity: 2,
      aiSummaryEn:
        "Test run after 3 days rest. 2km at 6:55/km — slightly faster than the 7:30 target. Foot arch tolerated it until the last 500m. Good confirmation that 2km is the current safe ceiling. Ice massage immediately after.",
      aiSummaryHe:
        "ריצת מבחן אחרי 3 ימי מנוחה. 2 ק\"מ ב-6:55 — מהיר מעט מהמטרה. הקשת החזיקה עד ל-500 המטרים האחרונים. אישור ש-2 ק\"מ הוא הגבול הבטוח כרגע.",
    },
  },

  // ── Session 7: Run-Walk 3 × 1km ───────────────────────────────────────────
  {
    performedAt: daysAgo(22, 8),
    type: "run",
    distanceKm: 3.43,
    durationMin: 36,
    rpe: 6,
    footPain: 1,
    notesRaw:
      "3 אינטרוולים של 1 ק\"מ ריצה (קצב 6:30) עם 2 דק' הליכה בין לבין. חימום 10 דק'. קצב ממוצע נראה 7:10 כי כולל הליכות. ללא כאבים בריצה עצמה.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "positive",
      symptoms: [],
      severity: 1,
      aiSummaryEn:
        "3 × 1km at 6:30 pace with 2min walk recoveries. 10min warmup. Avg shows 7:10 including walks. No pain during running — a clean session. The run-walk format is protecting the arch perfectly.",
      aiSummaryHe:
        "3 × 1 ק\"מ בקצב 6:30 עם 2 דק' הליכה. חימום 10 דק'. ממוצע 7:10 כולל הליכות. ללא כאבים — אימון נקי. פורמט הריצה-הליכה מגן על הקשת.",
    },
  },

  // ── Session 8: Run-Walk 3 × 1.2km ─────────────────────────────────────────
  {
    performedAt: daysAgo(18, 7),
    type: "run",
    distanceKm: 3.8,
    durationMin: 38,
    rpe: 6,
    footPain: 1,
    notesRaw:
      "3 פעמים 1.2 ק\"מ עם 2 דק' הפסקה. חימום 10 דק'. קצב 7:00 בריצה עצמה. לא היו כאבים ברגליים. 400 המטרים האחרונים היו הקשים לשרירי התאומים והדו-ראשי — סימן שהטכניקה עובדת.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "positive",
      symptoms: [],
      severity: 0,
      aiSummaryEn:
        "3 × 1.2km at 7:00 pace with 2min walk breaks. 10min warmup. No foot pain. Hamstrings and calves fatigued in the last 400m — a sign the new upright posture is activating the right muscle groups.",
      aiSummaryHe:
        "3 × 1.2 ק\"מ בקצב 7:00 עם 2 דק' הפסקה. ללא כאבי רגליים. עייפות בתאומים ובדו-ראשי ב-400 מטר האחרונים — סימן שהיציבה החדשה מפעילה את השרירים הנכונים.",
    },
  },

  // ── Session 9: Strength — park/home ──────────────────────────────────────
  {
    performedAt: daysAgo(16, 10),
    type: "strength",
    durationMin: 20,
    rpe: 5,
    footPain: 0,
    notesRaw:
      "אימון כוח - 3 סטים: 8 שכיבות סמיכה, 12 כפיפות בטן, 45 שניות פלאנק. הפסקה דקה בין סטים.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "positive",
      symptoms: [],
      severity: 0,
      aiSummaryEn:
        "3 sets: 8 push-ups, 12 bicycle crunches, 45s plank. Good core and upper body session. No load on feet — perfect recovery day format.",
      aiSummaryHe:
        "3 סטים: 8 שכיבות סמיכה, 12 כפיפות בטן, 45 שניות פלאנק. אימון ליבה ופלג גוף עליון. אפס עומס על הרגליים — פורמט מושלם לימי התאוששות.",
    },
  },

  // ── Session 10: 2 × 2km — new longest continuous run ─────────────────────
  {
    performedAt: daysAgo(12, 8),
    type: "run",
    distanceKm: 4.31,
    durationMin: 42,
    rpe: 7,
    footPain: 3,
    notesRaw:
      "2 × 2 ק\"מ ריצה רציפה עם 3 דק' הליכה. חימום 10 דק'. קצב 6:44 ו-6:38 בכל קמ'. ריצה רציפה הכי ארוכה עד כה. כאבים קלים בהליכת שחרור. שמרתי על גב זקוף ומבט קדימה לאורך כל הריצה.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "neutral",
      symptoms: ["arch_pain"],
      severity: 3,
      aiSummaryEn:
        "2 × 2km continuous at 6:41 avg pace — a new distance record for this training block. Maintained upright posture throughout. Mild arch pain during cool-down walk only. Volume jump from 1.2km to 2km intervals is the likely cause — run-walk format paid off.",
      aiSummaryHe:
        "2 × 2 ק\"מ רצוף בקצב 6:41 — שיא מרחק חדש בבלוק הזה. שמירה על גב זקוף לאורך כל הריצה. כאב קל בקשת בהליכת שחרור בלבד. קפיצת הנפח מ-1.2 ק\"מ ל-2 ק\"מ היא הסיבה הסבירה.",
    },
  },

  // ── Session 11: 3 × 1.5km intervals (most recent — from file 1) ──────────
  // 10min warmup + 3 × 1.5km at 6:36/6:52/6:52 + 3min walk between + cool-down walk
  {
    performedAt: daysAgo(6, 7),
    type: "run",
    distanceKm: 5.0,
    durationMin: 48,
    rpe: 7,
    footPain: 3,
    notesRaw:
      "יצאתי למרות מתח. 10 דק' חימום הליכה מהירה. 3 אינטרוולים של 1.5 ק\"מ ריצה ב-10 דק' עם 3 דק' הליכה בין האינטרוולים. הליכת שחרור בדרך הביתה. האינטרוול השני היה קשה בשרירי הירך והתאומים. ה-600 מטר האחרונים קשים בטכניקה/נשימה — שמרתי על גב זקוף. כפות הרגליים כאבו קצת בסוף.",
    notesLocale: "he",
    sentiment: {
      overallSentiment: "positive",
      symptoms: ["foot_pain", "muscle_fatigue"],
      severity: 3,
      aiSummaryEn:
        "Ran despite pre-run anxiety — a win in itself. 10min warmup + 3 × 1.5km at 6:36 / 6:52 / 6:52 with 3min walk recoveries. Very consistent pacing. Thigh and calf fatigue in interval 2; technique and breathing challenged in last 600m but maintained upright posture. Mild foot pain at end. Strong aerobic base confirmed.",
      aiSummaryHe:
        "יצאת למרות המתח — ניצחון כשלעצמו. חימום 10 דק' + 3 × 1.5 ק\"מ בקצב 6:36 / 6:52 / 6:52 עם 3 דק' הליכה. קצב יציב מאוד. עייפות בירך ובתאומים באינטרוול 2. ב-600 מטר האחרונים קושי בטכניקה/נשימה — אך שמרת על גב זקוף. כאב קל בסוף. בסיס אירובי חזק.",
    },
  },
];

// ── Main seed ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 AdaptiveFit history seed starting...\n");

  // Find user
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, "eran.ganot@gmail.com"),
  });
  if (!user) {
    console.error("❌ User eran.ganot@gmail.com not found. Sign in first, then run this script.");
    process.exit(1);
  }
  console.log(`✓ Found user: ${user.displayName ?? user.email}`);

  // Check if already seeded
  const existing = await db.query.workoutLogs.findMany({
    where: eq(schema.workoutLogs.userId, user.id),
  });
  if (existing.length >= HISTORY.length) {
    console.log(`ℹ️  Already seeded (${existing.length} logs found). Skipping.`);
    process.exit(0);
  }

  // Get existing performed_at timestamps to avoid duplicates
  const existingTimestamps = new Set(existing.map((l) => l.performedAt.toISOString()));

  let inserted = 0;
  for (const session of HISTORY) {
    if (existingTimestamps.has(session.performedAt.toISOString())) {
      console.log(`  ↩ Skipping (already exists): ${session.performedAt.toLocaleDateString()}`);
      continue;
    }

    // Insert workout log
    const [log] = await db
      .insert(schema.workoutLogs)
      .values({
        userId: user.id,
        performedAt: session.performedAt,
        type: session.type,
        distanceKm: session.distanceKm?.toString() ?? null,
        durationSec: session.durationMin ? minToSec(session.durationMin) : null,
        rpe: session.rpe,
        footPain: session.footPain,
        otherPain: session.otherPain ?? null,
        notesRaw: session.notesRaw,
        notesLocale: session.notesLocale,
      })
      .returning();

    // Insert feedback sentiment
    await db.insert(schema.feedbackSentiment).values({
      workoutLogId: log.id,
      overallSentiment: session.sentiment.overallSentiment,
      symptoms: session.sentiment.symptoms,
      severity: session.sentiment.severity,
      aiSummaryEn: session.sentiment.aiSummaryEn,
      aiSummaryHe: session.sentiment.aiSummaryHe,
      geminiModel: "seed-history-v1",
    });

    const dateStr = session.performedAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    const distStr = session.distanceKm ? ` ${session.distanceKm}km` : "";
    const painStr = session.footPain > 0 ? ` 🦶${session.footPain}` : "";
    console.log(
      `  ✓ ${dateStr}  [${session.type}]${distStr}  RPE ${session.rpe}${painStr}  → ${session.sentiment.overallSentiment}`,
    );
    inserted++;
  }

  console.log(`\n✅ Done — inserted ${inserted} sessions for ${user.email}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
