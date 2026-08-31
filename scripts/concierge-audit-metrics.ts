/**
 * Commitment grounding + conversational form score metrics.
 */
export type CommitmentViolation = {
  phrase: string;
  category: string;
  reason: string;
};

const COMMITMENT_PATTERNS: Array<{ re: RegExp; category: string; requires: string }> = [
  { re: /\bya revis[eé]\b/i, category: "calendar", requires: "calendar_query" },
  { re: /\b(qued[oó] agendad|confirmad[ao]|tu cita (es|qued[oó]))\b/i, category: "booking", requires: "appointment_confirmed" },
  { re: /\best[aá] disponible\b/i, category: "availability", requires: "calendar_query" },
  { re: /\b(se notific[oó]|avisamos al t[eé]cnico)\b/i, category: "notification", requires: "outbox_event" },
  { re: /\bel t[eé]cnico ir[aá]\b/i, category: "dispatch", requires: "appointment_confirmed" },
];

export function auditCommitments(
  reply: string,
  evidence: {
    calendarQueried?: boolean;
    appointmentConfirmed?: boolean;
    outboxEvent?: boolean;
  },
): CommitmentViolation[] {
  const violations: CommitmentViolation[] = [];
  for (const pattern of COMMITMENT_PATTERNS) {
    if (!pattern.re.test(reply)) continue;
    const ok =
      (pattern.requires === "calendar_query" && evidence.calendarQueried) ||
      (pattern.requires === "appointment_confirmed" && evidence.appointmentConfirmed) ||
      (pattern.requires === "outbox_event" && evidence.outboxEvent);
    if (!ok) {
      violations.push({
        phrase: reply.match(pattern.re)?.[0] || pattern.category,
        category: pattern.category,
        reason: `missing_evidence:${pattern.requires}`,
      });
    }
  }
  return violations;
}

export type FormScoreInput = {
  knownFieldsAskedAgain: number;
  duplicateQuestions: number;
  ignoredPackedFacts: number;
  forcedOptionalFields: number;
  genericOpenings: number;
  turns: number;
};

export function conversationalFormScore(input: FormScoreInput): { score: number; pass: boolean } {
  const penalty =
    input.knownFieldsAskedAgain * 3 +
    input.duplicateQuestions * 2 +
    input.ignoredPackedFacts * 4 +
    input.forcedOptionalFields * 2 +
    input.genericOpenings * 0.5;
  const normalized = Math.max(0, 100 - penalty);
  const score = Math.round(normalized / 10);
  return { score, pass: score >= 7 };
}

export function naturalnessScore(openingRepeats: number, turns: number): number {
  if (turns <= 1) return 10;
  const ratio = openingRepeats / turns;
  if (ratio <= 0.15) return 10;
  if (ratio <= 0.25) return 9;
  if (ratio <= 0.35) return 8;
  return 7;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const v = auditCommitments("Tu cita quedó confirmada para mañana.", {});
  console.log(v.length === 1 ? "COMMITMENT_AUDIT_SAMPLE_PASS" : "FAIL", v);
}
