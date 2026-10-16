/**
 * Isolated rollback behavior proof (no production, no SQLite restore).
 *
 * Scenarios:
 *  A) conversation pinned legacy
 *  B) conversation pinned n8n (with HS + appointment already created)
 *  C) n8n conversation with in-flight turn (INTERPRETING)
 *  D) after AI_CONCIERGE_ENGINE=legacy flip — what each path does
 *
 * Asserts: no mid-op engine switch, no duplicate booking, data retained.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "concierge-engine-rollback");

process.env.AI_CONCIERGE_ENABLED = "true";
process.env.AI_CONCIERGE_DRY_RUN = "true";
process.env.AI_CONCIERGE_CREATE_LEADS = "true";
process.env.CONCIERGE_INTERNAL_SECRET = "isolated-concierge-secret-not-for-prod";
process.env.NEXT_PUBLIC_PHONE = "+507 6000-1111";
process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP = "true";
process.env.OPENAI_API_KEY = "";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";

const evidenceDir = join(
  root,
  "docs",
  "auditoria-homestead-app",
  "evidence",
  `concierge-engine-rollback-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`,
);
mkdirSync(evidenceDir, { recursive: true });

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${detail}`);
}

// --- dynamic imports after env ---
process.env.AI_CONCIERGE_ENGINE = "n8n";
process.env.AI_CONCIERGE_N8N_MODE = "local";

const { resolveAndPinConversationEngine, getConversationEngine, pinConversationEngine, createTurn, updateTurn, getTurn } =
  await import("../src/lib/concierge/turn-store.ts");
const { startConcierge } = await import("../src/lib/concierge-engine.ts");
const { getConversation, addMessage, touchConversation } = await import("../src/lib/concierge-store.ts");
const { runConciergeN8nTurn } = await import("../src/lib/concierge/n8n-coordinator.ts");
const { toolUpsertRequest, toolBookAppointment, toolCheckAvailability } = await import(
  "../src/lib/concierge/business-tools.ts"
);
const { conciergeEngine } = await import("../src/lib/concierge-flags.ts");
const Database = require("better-sqlite3");
const dbPath = join(dataDir, "homestead.sqlite");

function snapConv(id) {
  const db = new Database(dbPath);
  const eng = db.prepare(`SELECT engine FROM concierge_conversations WHERE id = ?`).get(id);
  const lead = db.prepare(`SELECT lead_public_id FROM concierge_conversations WHERE id = ?`).get(id);
  const msgs = db.prepare(`SELECT COUNT(*) AS n FROM concierge_messages WHERE conversation_id = ?`).get(id);
  const turns = db
    .prepare(
      `SELECT turn_id, status, engine FROM concierge_turns WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 3`,
    )
    .all(id);
  db.close();
  return {
    engine: eng?.engine || "",
    lead: lead?.lead_public_id || "",
    messages: Number(msgs?.n || 0),
    turns,
  };
}

function apptForLead(leadId) {
  const db = new Database(dbPath);
  const rows = db
    .prepare(
      `SELECT appointment_id, date, start_time, status FROM revenue_appointments WHERE lead_id = ? ORDER BY rowid DESC`,
    )
    .all(leadId);
  db.close();
  return rows;
}

// A) Legacy conversation with history
const legacyId = startConcierge("127.0.0.1", { test: "rollback-legacy" });
pinConversationEngine(legacyId, "legacy");
addMessage(legacyId, "user", "hola tengo una fuga");
addMessage(legacyId, "assistant", "¿Me das teléfono?");
const legacyBefore = snapConv(legacyId);
record(
  "A_legacy_pin",
  legacyBefore.engine === "legacy" && legacyBefore.messages >= 2,
  `engine=${legacyBefore.engine} msgs=${legacyBefore.messages}`,
);

// B) Fresh n8n conversation → upsert + book
const n8nId = startConcierge("127.0.0.1", { test: "rollback-n8n" });
process.env.AI_CONCIERGE_ENGINE = "n8n";
const pinB = resolveAndPinConversationEngine(n8nId, "n8n");
record("B_pin_n8n", pinB === "n8n" && getConversationEngine(n8nId) === "n8n", `pin=${pinB}`);

// Seed facts for upsert/book via state
{
  const conv = getConversation(n8nId);
  const state = {
    ...conv.state,
    primaryService: "plumbing",
    service: "plumbing",
    problem: "fuga lavamanos rollback test",
    name: "Rollback N8n",
    customerName: "Rollback N8n",
    phone: "62229991",
    phoneE164: "+50762229991",
    locationText: "Bethania rollback",
    location: "Bethania",
    propertyType: "house",
    bookingIntent: true,
  };
  touchConversation(n8nId, { state });
}
const up = await toolUpsertRequest(n8nId, "fuga lavamanos rollback test");
const leadId = String(up.data?.publicId || "");
record("B_upsert", Boolean(up.ok && leadId), `ok=${up.ok} lead=${leadId} code=${up.code || ""}`);

// Free exclusive slots in isolated DB (CANCELLED rows do not block; CONFIRMED might).
{
  const db = new Database(dbPath);
  db.prepare(
    `UPDATE revenue_appointments SET status='CANCELLED', notes=COALESCE(notes,'')||' [rollback-test-clear]'
     WHERE status IN ('CONFIRMED','RESCHEDULED') AND date >= date('now')`,
  ).run();
  db.close();
}
const avail = await toolCheckAvailability(n8nId);
const slots = avail.data?.slots || [];
let book = { ok: false, code: "", message: "" };
for (const slot of slots) {
  book = await toolBookAppointment(n8nId, { date: slot.date, time: slot.time });
  if (book.ok) break;
}
const apptsBefore = leadId ? apptForLead(leadId) : [];
record(
  "B_book",
  Boolean(book.ok && apptsBefore.length >= 1),
  `ok=${book.ok} code=${book.code || ""} appts=${apptsBefore.length} first=${JSON.stringify(apptsBefore[0] || {})}`,
);

// One completed n8n turn (local mode) so pin is exercised through coordinator
const turnDone = await runConciergeN8nTurn({
  conversationId: n8nId,
  message: "ok gracias, ¿el WhatsApp de Homestead?",
});
record(
  "B_n8n_turn",
  Boolean(turnDone.ok && (turnDone.engine === "n8n" || getConversationEngine(n8nId) === "n8n")),
  `ok=${turnDone.ok} engine=${turnDone.engine || getConversationEngine(n8nId)} status=${turnDone.status}`,
);

// C) In-flight turn on n8n conversation
const inflight = createTurn({
  conversationId: n8nId,
  userText: "turno en curso rollback",
  engine: "n8n",
  idempotencyKey: `rollback-inflight-${randomUUID()}`,
});
updateTurn(inflight.turnId, { status: "INTERPRETING" });
const inflightRow = getTurn(inflight.turnId);
record(
  "C_inflight_created",
  inflightRow?.status === "INTERPRETING" && inflightRow.engine === "n8n",
  `turn=${inflight.turnId.slice(0, 8)} status=${inflightRow?.status}`,
);

// D) Flip global engine to legacy (simulates rollback script) — do NOT restore sqlite
process.env.AI_CONCIERGE_ENGINE = "legacy";
record("D_flag_legacy", conciergeEngine() === "legacy", `conciergeEngine()=${conciergeEngine()}`);

// D1) Legacy conversation stays legacy; chat path would use legacy
const engA = resolveAndPinConversationEngine(legacyId, conciergeEngine());
record("D_legacy_stays", engA === "legacy" && getConversationEngine(legacyId) === "legacy", `resolve=${engA}`);

// D2) n8n-pinned conversation STAYS n8n (pin wins; no mid-thread switch)
const engB = resolveAndPinConversationEngine(n8nId, conciergeEngine());
record(
  "D_n8n_pin_preserved",
  engB === "n8n" && getConversationEngine(n8nId) === "n8n",
  `resolve=${engB} (global legacy must not unpin)`,
);

// D3) In-flight turn unchanged — no engine rewrite, no auto-complete
const inflightAfter = getTurn(inflight.turnId);
record(
  "D_inflight_untouched",
  inflightAfter?.status === "INTERPRETING" && inflightAfter.engine === "n8n",
  `status=${inflightAfter?.status} engine=${inflightAfter?.engine}`,
);

// D4) Data retained — same lead + same appointment rows (no duplicate)
const apptsAfter = leadId ? apptForLead(leadId) : [];
record(
  "D_data_retained",
  apptsAfter.length === apptsBefore.length &&
    apptsAfter[0]?.appointment_id === apptsBefore[0]?.appointment_id &&
    leadId.length > 0,
  `lead=${leadId} apptsBefore=${apptsBefore.length} apptsAfter=${apptsAfter.length} id=${apptsAfter[0]?.appointment_id || ""}`,
);

// D5) Completing in-flight via finalize must not switch pin; mark DONE without second book
updateTurn(inflight.turnId, {
  status: "DONE",
  replyJson: JSON.stringify({
    ok: true,
    reply: "turno en curso finalizado tras rollback de flag",
    turnId: inflight.turnId,
    status: "DONE",
    engine: "n8n",
  }),
  completed: true,
});
const apptsFinal = leadId ? apptForLead(leadId) : [];
record(
  "D_no_duplicate_on_complete",
  apptsFinal.length === apptsBefore.length,
  `appts still ${apptsFinal.length} (no second book)`,
);

// D6) Brand-new conversation after rollback takes legacy
const freshId = startConcierge("127.0.0.1", { test: "rollback-fresh" });
const engFresh = resolveAndPinConversationEngine(freshId, conciergeEngine());
record("D_fresh_gets_legacy", engFresh === "legacy", `fresh pin=${engFresh}`);

const summary = {
  evidenceDir,
  globalEngineAfterRollback: conciergeEngine(),
  scenarios: {
    legacy: snapConv(legacyId),
    n8nPinned: { ...snapConv(n8nId), appointments: apptsFinal },
    freshAfterRollback: snapConv(freshId),
  },
  results,
  failed: results.filter((r) => !r.ok).length,
};
writeFileSync(join(evidenceDir, "RESULTS.json"), JSON.stringify(summary, null, 2));
writeFileSync(
  join(evidenceDir, "BEHAVIOR.md"),
  `# Concierge engine rollback — isolated proof

Global flag after rollback: \`${conciergeEngine()}\`

| Scenario | After rollback |
| --- | --- |
| Legacy pinned | Stays **legacy**; resolve returns legacy |
| n8n pinned (+ HS + cita) | Stays **n8n** (pin preserved); data kept; no duplicate cita |
| In-flight turn INTERPRETING | Remains INTERPRETING/n8n until completed; flag flip does not rewrite turn |
| New conversation | Pins **legacy** |

Failed: **${summary.failed}** / ${results.length}

Do not restore an old SQLite over live data to “rollback”.
`,
);

console.log(JSON.stringify({ evidenceDir, failed: summary.failed }, null, 2));
process.exit(summary.failed ? 1 : 0);
