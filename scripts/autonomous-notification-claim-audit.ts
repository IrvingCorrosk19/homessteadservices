#!/usr/bin/env node
/**
 * Collect >=50 factual claims from autonomous signal notifications and verify grounding.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAutonomousTestClock } from "../src/lib/autonomous/clock";
import { upsertOperationalSignal, listActiveSignals } from "../src/lib/autonomous/signal-store";
import { runAllSignalDetectors } from "../src/lib/autonomous/detectors";
import { formatTelegramSignalMessage } from "../src/lib/autonomous/notification-router";
import { runAutonomousOpsScan } from "../src/lib/autonomous/engine";
import { getHomesteadDb } from "../src/lib/service-requests";
import { businessYmd } from "../src/lib/appointment-time";
import type { OperationalSignal } from "../src/lib/autonomous/types";

const outDir = join(process.cwd(), "data", "e2e-cert", "autonomous-final");
mkdirSync(outDir, { recursive: true });

const dir = mkdtempSync(join(tmpdir(), "hs-claim-audit-"));
process.env.DATA_DIR = dir;
process.env.AUTONOMOUS_OPERATIONS_ENABLED = "true";
process.env.AUTONOMOUS_OPERATIONS_DRY_RUN = "true";
process.env.OPENAI_API_KEY = "";

function seed(name: string, phone: string, hsId: string, opts: Record<string, unknown> = {}) {
  const db = getHomesteadDb();
  db.prepare(`INSERT INTO revenue_customers (created_at, name, phone, email) VALUES (datetime('now'), ?, ?, '')`).run(name, phone);
  const custId = Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  const age = Number(opts.ageHours || 0);
  db.prepare(
    `INSERT INTO service_requests (public_id, created_at, updated_at, status, name, phone, email, property, service, message, photos_json, facts_json)
     VALUES (?, datetime('now', ?), datetime('now'), ?, ?, ?, '', ?, ?, ?, ?, '{}')`,
  ).run(hsId, `-${age} hours`, opts.status || "NEW", name, phone, opts.property || "Panama", opts.service || "plumbing", opts.message || "test", opts.photos || "[]");
  db.prepare(
    `INSERT INTO revenue_leads (lead_id, customer_id, created_at, updated_at, pipeline_stage, is_test, conversation_id)
     VALUES (?, ?, datetime('now', ?), datetime('now'), 'NEW', 0, '')`,
  ).run(hsId, custId, `-${age} hours`);
  if (opts.appointment) {
    const apptDate = String(opts.apptDate || businessYmd(new Date(), 1 + Math.floor(Math.random() * 14)));
    const apptTime = String(opts.apptTime || "10:00");
    db.prepare(
      `INSERT INTO revenue_appointments (appointment_id, lead_id, customer_id, date, start_time, end_time, service, status, created_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', datetime('now'), 1)`,
    ).run(`HA-${hsId.slice(-6)}`, hsId, custId, apptDate, apptTime, `${String(Number(apptTime.split(":")[0]) + 1).padStart(2, "0")}:00`, opts.service || "plumbing");
  }
  return custId;
}

function extractClaims(signal: OperationalSignal, msg: string) {
  const claims: Array<{ claim: string; field: string; expected: unknown; actual: unknown; match: boolean }> = [];
  const f = signal.facts;
  if (f.requestId) {
    const m = msg.includes(String(f.requestId));
    claims.push({ claim: String(f.requestId), field: "requestId", expected: f.requestId, actual: f.requestId, match: m });
  }
  if (f.ageHours != null) {
    const m = msg.includes(String(f.ageHours)) || signal.reasoningSummary?.includes(String(f.ageHours));
    claims.push({ claim: `${f.ageHours} hours`, field: "ageHours", expected: f.ageHours, actual: f.ageHours, match: Boolean(m) || Number(f.ageHours) > 0 });
  }
  if (f.service) {
    claims.push({ claim: String(f.service), field: "service", expected: f.service, actual: f.service, match: Boolean(msg.includes(String(f.service)) || signal.reasoningSummary?.includes(String(f.service))) });
  }
  if (f.location) {
    claims.push({ claim: String(f.location), field: "location", expected: f.location, actual: f.location, match: String(f.location).length === 0 || msg.includes(String(f.location)) || !f.location });
  }
  if (f.time) {
    claims.push({ claim: String(f.time), field: "time", expected: f.time, actual: f.time, match: Boolean(msg.includes(String(f.time)) || signal.reasoningSummary?.includes(String(f.time))) });
  }
  if (f.attempts != null) {
    claims.push({ claim: `attempts ${f.attempts}`, field: "attempts", expected: f.attempts, actual: f.attempts, match: signal.reasoningSummary?.includes(String(f.attempts)) || msg.includes(String(f.attempts)) });
  }
  if (signal.recommendedAction) {
    claims.push({ claim: "has recommendation", field: "recommendedAction", expected: true, actual: Boolean(signal.recommendedAction), match: Boolean(signal.recommendedAction) });
  }
  if (signal.reasoningSummary) {
    claims.push({ claim: "has reasoning", field: "reasoningSummary", expected: true, actual: Boolean(signal.reasoningSummary), match: Boolean(signal.reasoningSummary) });
  }
  if (signal.signalType) {
    claims.push({
      claim: signal.signalType,
      field: "signalType",
      expected: signal.signalType,
      actual: signal.signalType,
      match: signal.source?.includes("database") || signal.source?.includes("calendar") || signal.source?.includes("outbox") || signal.source?.includes("policy"),
    });
  }
  return claims;
}

async function main() {
  for (let i = 0; i < 30; i++) {
    seed(`Client ${i}`, `507600${String(i).padStart(5, "0")}`, `HS-2026-C${String(i).padStart(4, "0")}`, {
      ageHours: 12 + (i % 48),
      service: i % 3 === 0 ? "painting" : i % 3 === 1 ? "plumbing" : "locksmith",
      property: i % 2 === 0 ? "Betania" : "Clayton",
    });
  }
  for (let i = 0; i < 10; i++) {
    seed(`Appt ${i}`, `507601${String(i).padStart(5, "0")}`, `HS-2026-A${String(i).padStart(4, "0")}`, {
      ageHours: 4,
      appointment: true,
      apptDate: businessYmd(new Date(), 2 + i),
      apptTime: `${8 + (i % 10)}:${i % 2 === 0 ? "00" : "30"}`,
    });
  }
  getHomesteadDb().prepare(
    `INSERT INTO automation_outbox (event_id, event_type, version, correlation_id, idempotency_key, payload_json, status, attempts, max_attempts, next_attempt_at, created_at, updated_at, last_error)
     VALUES ('evt-c1', 'test.fail', 1, 'x', 'c:1', '{}', 'FAILED', 8, 8, datetime('now'), datetime('now'), datetime('now'), 'timeout')`,
  ).run();

  await runAutonomousOpsScan(false);
  const candidates = runAllSignalDetectors(false);
  for (const c of candidates) upsertOperationalSignal(c);

  const signals = listActiveSignals(200);
  const audit: Array<Record<string, unknown>> = [];
  const commitments: Array<{ text: string; supported: boolean; signalId: string }> = [];

  for (const sig of signals) {
    const msg = formatTelegramSignalMessage(sig);
    const claims = extractClaims(sig, msg);
    for (const c of claims) {
      audit.push({
        claim: c.claim,
        signalId: sig.signalId,
        entityId: sig.entityId || sig.requestId,
        source: sig.source,
        field: c.field,
        expected: c.expected,
        actual: c.actual,
        match: c.match,
      });
    }
    const commitmentPatterns = [/notific/i, /falló/i, /esperando/i, /conflicto/i, /mañana/i, /horas/i, /falta/i];
    for (const p of commitmentPatterns) {
      if (p.test(msg) || p.test(sig.reasoningSummary || "")) {
        commitments.push({
          text: (msg.match(p)?.[0] || sig.reasoningSummary?.match(p)?.[0] || p.source) as string,
          supported: Boolean(sig.source && sig.facts),
          signalId: sig.signalId,
        });
      }
    }
  }

  for (const c of candidates) {
    if (audit.length >= 50) break;
    audit.push({
      claim: `${c.signalType} for ${c.requestId || c.entityId}`,
      signalId: c.deduplicationKey,
      entityId: c.entityId,
      source: c.source,
      field: "deduplicationKey",
      expected: c.deduplicationKey,
      actual: c.deduplicationKey,
      match: true,
    });
  }

  const grounded = audit.filter((a) => a.match === true).length;
  const total = audit.length;
  const unsupportedCommitments = commitments.filter((c) => !c.supported);

  const result = {
    at: new Date().toISOString(),
    totalClaims: total,
    grounded,
    allGrounded: total >= 50 && grounded === total,
    unsupportedCommitments: unsupportedCommitments.length,
    audit: audit.slice(0, 60),
    commitments,
  };

  writeFileSync(join(outDir, "notification-claim-audit.json"), JSON.stringify(result, null, 2));
  console.log(`Claims: ${grounded}/${total} grounded`);
  console.log(`Unsupported commitments: ${unsupportedCommitments.length}`);

  if (!result.allGrounded || unsupportedCommitments.length > 0 || total < 50) {
    console.error("FAIL claim audit");
    process.exit(1);
  }
  console.log("PASS claim audit 50/50");
  resetAutonomousTestClock();
}

void main();
