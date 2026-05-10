/**
 * lib/coach/chatTools.ts
 *
 * Round 6 Deploy 2 — propose-and-approve plan changes from chat.
 *
 * These are PROPOSALS, not actions. When Gemini emits a function call from
 * this list, the server persists it as a `pending` row in coach_chat_actions
 * but does NOT apply the change. The user must explicitly approve via the
 * chat UI before any plan write happens.
 *
 * Why propose-only?
 * - Eran's explicit choice (2026-05-09): "act only when I approve him to act,
 *   but always suggest me and ask permission."
 * - Removes the risk of an autonomous agent over-stepping.
 * - All four proposals are scoped narrowly (no general "modify anything" tool).
 * - Approved actions are reversible via Undo (reversal JSON snapshot).
 */
import { SchemaType, type Tool } from "@google/generative-ai";

/** Controlled vocabulary for symptoms — must match what feedbackSentiment.symptoms accepts. */
export const SYMPTOM_VOCAB = [
  "form_breakdown",
  "breathing_dereg",
  "plantar_flare",
  "calf_tight",
  "knee_pain",
  "hip_tight",
] as const;
export type SymptomTag = (typeof SYMPTOM_VOCAB)[number];

/** Action types persisted in coach_chat_actions.action_type. */
export type ActionType = "soften_session" | "swap_to_rest" | "freeze_week" | "record_symptom";

/** Parameter shapes per action type. The server validates these before persisting. */
export type ActionParams =
  | { type: "soften_session"; sessionId: string; reductionPct?: number }
  | { type: "swap_to_rest"; sessionId: string }
  | { type: "freeze_week"; days: number }
  | { type: "record_symptom"; symptom: SymptomTag; severity: number };

/**
 * Gemini Tool declarations. Pass these as `tools: COACH_CHAT_TOOLS` when
 * creating the model. Gemini will emit function calls matching these names
 * and parameters; the server intercepts them as proposals.
 */
export const COACH_CHAT_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "proposeSoftenSession",
        description:
          "Propose reducing the volume or intensity of a future planned roadmap session. " +
          "Use this when the athlete reports rising pain, fatigue, or an off day, and the " +
          "next workout should be eased rather than skipped entirely. The user will see " +
          "an Approve/Decline card; you do NOT apply this change yourself.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            sessionId: {
              type: SchemaType.STRING,
              description: "UUID of the roadmap session to soften.",
            },
            reason: {
              type: SchemaType.STRING,
              description: "One-sentence reason why this should be eased.",
            },
            reductionPct: {
              type: SchemaType.NUMBER,
              description: "Percent reduction in volume (10-50). Default 25 if omitted.",
            },
          },
          required: ["sessionId", "reason"],
        },
      },
      {
        name: "proposeSwapToRest",
        description:
          "Propose replacing a planned session with rest/mobility. Use when an injury " +
          "or pain spike means a workout should be skipped entirely (not just eased). " +
          "The user will see an Approve/Decline card; you do NOT apply this change yourself.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            sessionId: {
              type: SchemaType.STRING,
              description: "UUID of the roadmap session to swap to rest.",
            },
            reason: {
              type: SchemaType.STRING,
              description: "One-sentence reason why rest is appropriate.",
            },
          },
          required: ["sessionId", "reason"],
        },
      },
      {
        name: "proposeFreezeWeek",
        description:
          "Propose activating a coach freeze for N days, halting progression entirely. " +
          "Use for serious flare-ups requiring a full recovery period. The user will see " +
          "an Approve/Decline card; you do NOT apply this change yourself.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            days: {
              type: SchemaType.INTEGER,
              description: "How many days the freeze should last (1-14).",
            },
            reason: {
              type: SchemaType.STRING,
              description: "One-sentence reason why a freeze is appropriate.",
            },
          },
          required: ["days", "reason"],
        },
      },
      {
        name: "proposeRecordSymptom",
        description:
          "Propose recording a symptom on the workout being discussed. Symptoms feed the " +
          "FSM next regen — they automatically soften upcoming sessions. Use this when " +
          "the athlete describes a symptom that wasn't logged with the original workout. " +
          "The user will see an Approve/Decline card; you do NOT apply this change yourself.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            symptom: {
              type: SchemaType.STRING,
              description:
                "One of: form_breakdown, breathing_dereg, plantar_flare, calf_tight, knee_pain, hip_tight.",
              enum: [...SYMPTOM_VOCAB],
            },
            severity: {
              type: SchemaType.INTEGER,
              description: "Severity on a 0-10 scale.",
            },
            reason: {
              type: SchemaType.STRING,
              description: "One-sentence reason for recording this symptom.",
            },
          },
          required: ["symptom", "severity", "reason"],
        },
      },
    ],
  },
];

/**
 * Map a Gemini function-call name to its action_type for the DB.
 * Returns null for unknown names (defensive — should never happen if Gemini
 * sticks to the declared tools).
 */
export function functionNameToActionType(name: string): ActionType | null {
  switch (name) {
    case "proposeSoftenSession": return "soften_session";
    case "proposeSwapToRest": return "swap_to_rest";
    case "proposeFreezeWeek": return "freeze_week";
    case "proposeRecordSymptom": return "record_symptom";
    default: return null;
  }
}
