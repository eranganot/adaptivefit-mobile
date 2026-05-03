/**
 * AdaptiveFit DB schema (Drizzle / Postgres)
 * Lifted and extended from eranganot/adaptivefit drizzle/schema.ts.
 *
 * Additions vs the old repo:
 * - `goals` table (single active goal per user, drives the coach roadmap)
 * - `workout_logs.foot_pain` as a typed first-class column (drives coach freezes)
 * - `workout_logs.rtl` generated column (Relative Training Load = distance × effort)
 * - `feedback_sentiment` slimmed to symptoms + bilingual ai_summary
 *
 * Conventions:
 * - All ids are uuids generated server-side
 * - All timestamps are timestamptz
 * - `notes_locale` is detected by Gemini (or simple regex) on insert
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Custom bytea type for photo storage (single-user MVP)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ─────────────────────────────────────────────────────────────────
// users
// ─────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  googleSub: text("google_sub").unique(),
  displayName: text("display_name"),
  locale: text("locale", { enum: ["en", "he"] }).notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// goals — one active per user; coach plans against this target
// ─────────────────────────────────────────────────────────────────
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // High-level category (Bug #6 Phase 1)
    category: text("category", {
      enum: ["running", "body_shape", "weight_loss", "strength"],
    }).notNull().default("running"),
    type: text("type", {
      enum: ["5k_time", "10k_time", "weekly_volume_km", "sessions_per_week", "custom"],
    }).notNull(),
    targetValue: numeric("target_value", { precision: 10, scale: 2 }).notNull(),
    targetUnit: text("target_unit", {
      enum: ["sec", "km", "sessions", "free", "kg", "pct"],
    }).notNull(),
    targetDate: date("target_date").notNull(),
    note: text("note"),
    status: text("status", { enum: ["active", "achieved", "archived"] })
      .notNull()
      .default("active"),
    // Body-shape / strength: user-set training mix (0-100, e.g. 60 = 60% primary modality)
    trainingMixPct: integer("training_mix_pct"),
    // Weight-loss: user's current actual weight (kg) at goal-creation time
    currentValue: numeric("current_value", { precision: 10, scale: 2 }),
    // Strength: target lifts as JSON {bench5rm, squat5rm, deadlift5rm}
    targetLifts: jsonb("target_lifts"),
    // Sessions per week target (used by all categories)
    sessionsPerWeek: integer("sessions_per_week"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Enforce a single active goal per user via partial unique index
    oneActivePerUser: uniqueIndex("goals_one_active_per_user")
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  }),
);

// ─────────────────────────────────────────────────────────────────
// body_metrics — weight / body-fat measurements (Bug #6 Phase 2)
// ─────────────────────────────────────────────────────────────────
export const bodyMetrics = pgTable(
  "body_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(), // YYYY-MM-DD
    weightKg: numeric("weight_kg", { precision: 5, scale: 2 }),
    bodyFatPct: numeric("body_fat_pct", { precision: 4, scale: 1 }),
    waistCm: numeric("waist_cm", { precision: 5, scale: 1 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userDateIdx: uniqueIndex("body_metrics_user_date_idx").on(t.userId, t.date),
  }),
);

// ─────────────────────────────────────────────────────────────────
// strength_logs — per-exercise lift records linked to a workout (Bug #6 Phase 2)
// ─────────────────────────────────────────────────────────────────
export const strengthLogs = pgTable("strength_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutLogId: uuid("workout_log_id")
    .notNull()
    .references(() => workoutLogs.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  exercise: text("exercise").notNull(), // e.g. "bench_press", "squat", "deadlift"
  weightKg: numeric("weight_kg", { precision: 5, scale: 2 }).notNull(),
  reps: integer("reps").notNull(),
  sets: integer("sets").notNull().default(1),
  rpe: integer("rpe"), // optional effort rating for this lift
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// workout_logs
// ─────────────────────────────────────────────────────────────────
export const workoutLogs = pgTable("workout_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull(),
  type: text("type", { enum: ["run", "strength", "mobility", "other"] }).notNull(),
  distanceKm: numeric("distance_km", { precision: 6, scale: 2 }),
  durationSec: integer("duration_sec"),
  // Generated: pace_sec_per_km = duration_sec / distance_km if both present
  paceSecPerKm: integer("pace_sec_per_km").generatedAlwaysAs(
    sql`CASE WHEN duration_sec IS NOT NULL AND distance_km IS NOT NULL AND distance_km > 0
            THEN (duration_sec / distance_km)::int ELSE NULL END`,
  ),
  exercises: text("exercises").array(),
  rpe: integer("rpe").notNull(), // 1-10 enforced in app layer + check below
  footPain: integer("foot_pain").notNull().default(0), // 0-10
  otherPain: text("other_pain"),
  notesRaw: text("notes_raw"),
  notesLocale: text("notes_locale", { enum: ["en", "he"] }),
  // Relative Training Load = distance_km × (rpe/10). Only meaningful for runs;
  // we still store on every row so analytics can SUM blindly.
  rtl: numeric("rtl", { precision: 8, scale: 3 }).generatedAlwaysAs(
    sql`CASE WHEN type = 'run' AND distance_km IS NOT NULL
            THEN ROUND((distance_km * (rpe::numeric / 10))::numeric, 3)
            ELSE 0 END`,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// feedback_sentiment — Gemini's structured read on the workout's free text
// ─────────────────────────────────────────────────────────────────
export const feedbackSentiment = pgTable("feedback_sentiment", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutLogId: uuid("workout_log_id")
    .notNull()
    .references(() => workoutLogs.id, { onDelete: "cascade" })
    .unique(),
  overallSentiment: text("overall_sentiment", {
    enum: ["positive", "neutral", "concern"],
  }).notNull(),
  // Free-form list using a controlled vocabulary; see lib/gemini/extractFeedback.ts
  symptoms: text("symptoms").array().notNull().default(sql`ARRAY[]::text[]`),
  severity: integer("severity").notNull(), // 0-10 derived
  aiSummaryEn: text("ai_summary_en"),
  aiSummaryHe: text("ai_summary_he"),
  geminiModel: text("gemini_model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// user_level_state — conservative coach FSM (level 1-10, freezes, greens)
// ─────────────────────────────────────────────────────────────────
export const userLevelState = pgTable("user_level_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentLevel: integer("current_level").notNull().default(1),
  greenSessionCount: integer("green_session_count").notNull().default(0),
  freezeActive: boolean("freeze_active").notNull().default(false),
  freezeReason: text("freeze_reason"),
  // ISO date of last evaluation; coach skips re-running the same day
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  // Manual override: gates FSM promotions for 7 days after user sets a level manually
  manualOverride: boolean("manual_override").notNull().default(false),
  manualOverrideUntil: timestamp("manual_override_until", { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────
// training_roadmap — coach's plan keyed to active goal + week + day
// ─────────────────────────────────────────────────────────────────
export const trainingRoadmap = pgTable("training_roadmap", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  weekIndex: integer("week_index").notNull(),
  dayIndex: integer("day_index").notNull(), // 0=Mon..6=Sun
  sessionPlan: jsonb("session_plan").notNull(), // {title, blocks:[...], warmup, mobility}
  status: text("status", {
    enum: ["pending", "completed", "skipped", "modified"],
  })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// cold_start_analysis — one-off Gemini imports during onboarding
// ─────────────────────────────────────────────────────────────────
export const coldStartAnalysis = pgTable("cold_start_analysis", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source", {
    enum: ["gemini_import", "manual_history", "takeout"],
  }).notNull(),
  rawInput: text("raw_input").notNull(),
  extracted: jsonb("extracted").notNull(),
  // Recommendation tracking — user must explicitly accept or override
  recommendedLevel: integer("recommended_level"),
  acceptedLevel: integer("accepted_level"),
  status: text("status", { enum: ["pending", "accepted", "overridden"] })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// workout_photos — optional photo attached to a workout log (MVP: bytea)
// ─────────────────────────────────────────────────────────────────
export const workoutPhotos = pgTable("workout_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutLogId: uuid("workout_log_id")
    .notNull()
    .references(() => workoutLogs.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// coach_chat_messages — continuation conversation after a workout
// ─────────────────────────────────────────────────────────────────
export const coachChatMessages = pgTable(
  "coach_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workoutLogId: uuid("workout_log_id").references(() => workoutLogs.id, {
      onDelete: "set null",
    }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    locale: text("locale", { enum: ["en", "he"] }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWorkoutIdx: index("coach_chat_user_workout_idx").on(
      t.userId,
      t.workoutLogId,
      t.createdAt,
    ),
  }),
);
// ─────────────────────────────────────────────────────────────────
// run_sessions — one row per GPS-tracked run (Phase 2)
// ─────────────────────────────────────────────────────────────────
export const runSessions = pgTable("run_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workoutLogId: uuid("workout_log_id").unique().references(() => workoutLogs.id, {
    onDelete: "set null",
  }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  distanceKm: numeric("distance_km", { precision: 6, scale: 3 }).notNull(),
  durationSec: integer("duration_sec").notNull(),
  avgPaceSecPerKm: integer("avg_pace_sec_per_km").notNull(),
  splits: jsonb("splits").notNull(), // [{km:1, paceSec:330}, ...]
  source: text("source", { enum: ["gps", "manual", "fit"] }).notNull().default("gps"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// gps_points — raw GPS trail for a run session (Phase 2)
// ─────────────────────────────────────────────────────────────────
export const gpsPoints = pgTable(
  "gps_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runSessionId: uuid("run_session_id")
      .notNull()
      .references(() => runSessions.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    accuracyM: numeric("accuracy_m", { precision: 6, scale: 2 }),
    altitudeM: numeric("altitude_m", { precision: 7, scale: 2 }),
    heartRate: integer("heart_rate"),
    stepsDelta: integer("steps_delta"),
  },
  (t) => ({
    sessionTsIdx: index("gps_points_session_ts_idx").on(t.runSessionId, t.ts),
  }),
);

// ─────────────────────────────────────────────────────────────────
// oauth_tokens — stores Google Fit OAuth credentials per user (Phase 3)
// ─────────────────────────────────────────────────────────────────
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google_fit"] }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    status: text("status", { enum: ["active", "error", "revoked"] })
      .notNull()
      .default("active"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProviderIdx: uniqueIndex("oauth_tokens_user_provider_idx").on(t.userId, t.provider),
  }),
);

// ─────────────────────────────────────────────────────────────────
// fit_daily_metrics — daily aggregates pulled from Google Fit (Phase 3)
// ─────────────────────────────────────────────────────────────────
export const fitDailyMetrics = pgTable(
  "fit_daily_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(), // YYYY-MM-DD
    steps: integer("steps"),
    distanceM: integer("distance_m"),        // metres
    activeMinutes: integer("active_minutes"),
    avgHr: integer("avg_hr"),               // bpm average for the day
    calories: integer("calories"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userDateIdx: uniqueIndex("fit_daily_metrics_user_date_idx").on(t.userId, t.date),
  }),
);

// ─────────────────────────────────────────────────────────────────
// fit_sessions — workout sessions pulled from Google Fit (Phase 3)
// ─────────────────────────────────────────────────────────────────
export const fitSessions = pgTable(
  "fit_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fitSessionId: text("fit_session_id").notNull(),  // Google Fit session ID
    activityType: integer("activity_type").notNull(), // Google Fit activity type int
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    distanceM: integer("distance_m"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    steps: integer("steps"),
    calories: integer("calories"),
    route: jsonb("route"),  // [{lat, lon, ts}] polyline if available
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userFitSessionIdx: uniqueIndex("fit_sessions_user_fit_session_idx").on(t.userId, t.fitSessionId),
    userStartTimeIdx: index("fit_sessions_user_start_time_idx").on(t.userId, t.startTime),
  }),
);

// Type exports for use in app code
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type NewBodyMetric = typeof bodyMetrics.$inferInsert;
export type StrengthLog = typeof strengthLogs.$inferSelect;
export type NewStrengthLog = typeof strengthLogs.$inferInsert;
export type WorkoutLog = typeof workoutLogs.$inferSelect;
export type NewWorkoutLog = typeof workoutLogs.$inferInsert;
export type FeedbackSentiment = typeof feedbackSentiment.$inferSelect;
export type NewFeedbackSentiment = typeof feedbackSentiment.$inferInsert;
export type UserLevelState = typeof userLevelState.$inferSelect;
export type TrainingRoadmap = typeof trainingRoadmap.$inferSelect;
export type NewTrainingRoadmap = typeof trainingRoadmap.$inferInsert;
export type ColdStartAnalysis = typeof coldStartAnalysis.$inferSelect;
export type WorkoutPhoto = typeof workoutPhotos.$inferSelect;
export type CoachChatMessage = typeof coachChatMessages.$inferSelect;
export type NewCoachChatMessage = typeof coachChatMessages.$inferInsert;
export type RunSession = typeof runSessions.$inferSelect;
export type NewRunSession = typeof runSessions.$inferInsert;
export type GpsPoint = typeof gpsPoints.$inferSelect;
export type NewGpsPoint = typeof gpsPoints.$inferInsert;
export type OauthToken = typeof oauthTokens.$inferSelect;
export type NewOauthToken = typeof oauthTokens.$inferInsert;
export type FitDailyMetric = typeof fitDailyMetrics.$inferSelect;
export type NewFitDailyMetric = typeof fitDailyMetrics.$inferInsert;
export type FitSession = typeof fitSessions.$inferSelect;
export type NewFitSession = typeof fitSessions.$inferInsert;
