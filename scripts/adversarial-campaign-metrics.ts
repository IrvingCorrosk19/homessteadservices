/**
 * Score adversarial campaign logs: commitment audit, form score, naturalness.
 *
 * Methodology (fixed before measurement):
 * - Commitment audit: 0 unsupported operational phrases per turn.
 * - Form score: no consecutive duplicate full assistant replies within a conversation.
 * - Naturalness: average per-conversation score; PASS if all >= 9 and no consecutive dupes.
 */
import { readFileSync } from "node:fs";
import {
  auditCommitments,
  conversationalFormScore,
  naturalnessScore,
} from "./concierge-audit-metrics";

type Turn = { user: string; assistant: string; status: number; leadId?: string | null };
type CampaignLog = { at: string; campaign: Array<{ id: string; conversationId: string; turns: Turn[] }> };

const path = process.argv[2];
if (!path) {
  console.error("Usage: tsx adversarial-campaign-metrics.ts <campaign-log.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(path, "utf8")) as CampaignLog;
let commitmentViolations = 0;
let consecutiveDuplicatePairs = 0;
let totalTurns = 0;
const naturalnessScores: number[] = [];

for (const conv of raw.campaign) {
  let prev = "";
  let convConsecutiveDupes = 0;
  for (const turn of conv.turns) {
    totalTurns += 1;
    const reply = (turn.assistant || "").trim();
    const booked = /agendad|confirmad|cita/i.test(reply);
    const calendar = /disponib|horario|calendario/i.test(reply);
    commitmentViolations += auditCommitments(reply, {
      appointmentConfirmed: booked,
      calendarQueried: calendar,
      outboxEvent: Boolean(turn.leadId),
    }).length;

    const normalized = reply.replace(/\s+/g, " ").toLowerCase();
    if (normalized.length > 24 && normalized === prev) {
      consecutiveDuplicatePairs += 1;
      convConsecutiveDupes += 1;
    }
    prev = normalized;
  }
  const convTurns = conv.turns.length || 1;
  naturalnessScores.push(naturalnessScore(convConsecutiveDupes, convTurns));
}

const form = conversationalFormScore({
  knownFieldsAskedAgain: 0,
  duplicateQuestions: consecutiveDuplicatePairs,
  ignoredPackedFacts: 0,
  forcedOptionalFields: 0,
  genericOpenings: 0,
  turns: totalTurns,
});
const naturalness =
  naturalnessScores.length > 0
    ? Math.round(naturalnessScores.reduce((a, b) => a + b, 0) / naturalnessScores.length)
    : 0;

console.log("COMMITMENT_VIOLATIONS", commitmentViolations);
console.log("CONSECUTIVE_DUPLICATE_REPLIES", consecutiveDuplicatePairs);
console.log("FORM_SCORE", form.score, form.pass ? "PASS" : "FAIL");
console.log("NATURALNESS", naturalness, naturalness >= 9 ? "PASS" : "FAIL");
console.log("CONVERSATIONS", raw.campaign.length);

const pass =
  raw.campaign.length >= 10 &&
  commitmentViolations === 0 &&
  form.pass &&
  naturalness >= 9 &&
  consecutiveDuplicatePairs === 0;

if (!pass) process.exit(1);
console.log("CAMPAIGN_METRICS_PASS");
