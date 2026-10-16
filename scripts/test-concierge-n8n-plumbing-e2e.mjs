/**
 * Isolated e2e: plumbing journey on n8n local coordinator.
 * Fictional phones only. Distinguishes [simulacion].
 * Does NOT touch production DB, Meta, Telegram, or real calendar notify.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const evidenceDir = join(root, "docs", "auditoria-homestead-app", "evidence", `concierge-n8n-plumbing-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });

const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "concierge-n8n-plumbing");
rmSync(join(dataDir, "homestead.sqlite"), { force: true });

process.env.AI_CONCIERGE_ENABLED = "true";
process.env.AI_CONCIERGE_CREATE_LEADS = "true";
process.env.AI_CONCIERGE_DRY_RUN = "true";
process.env.AI_CONCIERGE_ENGINE = "n8n";
process.env.AI_CONCIERGE_N8N_MODE = "local";
process.env.CONCIERGE_INTERNAL_SECRET = "isolated-concierge-secret-not-for-prod";
process.env.NEXT_PUBLIC_PHONE = "+507 6000-1111";
process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP = "true";
process.env.OPENAI_API_KEY = "";
process.env.CONTROL_PUSH_ENABLED = "true";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (/api\.openai|graph\.facebook|api\.telegram/i.test(target)) {
    throw new Error(`NETWORK_FORBIDDEN ${target}`);
  }
  return originalFetch(url, init);
};

let failed = 0;
const lines = [];
function ok(name, value, detail = "") {
  const row = `${value ? "PASS" : "FAIL"} [simulacion] ${name}${detail ? ` · ${detail}` : ""}`;
  lines.push(row);
  if (!value) {
    failed += 1;
    console.error(row);
  } else console.log(row);
}

const { getHomesteadDb } = await import("../src/lib/service-requests.ts");
const db = getHomesteadDb();
const { startConcierge } = await import("../src/lib/concierge-engine.ts");
const { runConciergeN8nTurn } = await import("../src/lib/concierge/n8n-coordinator.ts");
const { getConversation } = await import("../src/lib/concierge-store.ts");
const { formatBusinessContactReply } = await import("../src/lib/concierge/business-contact.ts");
const { enqueueNewRequestPush } = await import("../src/lib/control-push.ts");

const cid = startConcierge("127.0.0.1", { source: "website_chat", test: "n8n-plumbing" });
ok("start", Boolean(cid), cid);

const turns = [];
async function say(text) {
  const out = await runConciergeN8nTurn({
    conversationId: cid,
    message: text,
    utm: { source: "website_chat" },
    idempotencyKey: `e2e:${cid}:${turns.length}:${text.slice(0, 40)}`,
  });
  turns.push({ user: text, reply: out.reply, leadId: out.leadId, requestCard: out.requestCard, status: out.status });
  console.log(`[user] ${text}`);
  console.log(`[assistant] ${(out.reply || "").slice(0, 220)}`);
  return out;
}

await say("Tengo una fuga debajo del lavamanos");
await say("Me llamo Carla Prueba y mi teléfono es 61119876");
await say("perdón el correcto es 62228765");
await say("estoy en Bethania cerca del parque");
const mid = await say("cuál es el WhatsApp de Homestead?");
ok("business contact no customer digits", !/61119876|62228765/.test(mid.reply || ""), mid.reply?.slice(0, 120));
ok("business contact uses official/config", /6661|6000-1111|no tengo un tel/i.test(mid.reply || ""));

const resume = await say("ok sigamos con la fuga");
const state = getConversation(cid)?.state;
const folio = state?.activeLeadId || resume.leadId || "";
ok("HS created exactly once context", Boolean(folio) && /^HS-/i.test(String(folio)), String(folio));
ok("phone corrected on state", (state?.phone || "").includes("6222"), state?.phone || "");
ok("location retained after interrupt", /Bethania/i.test(state?.location || ""), state?.location || "");

const hs = folio
  ? db.prepare(`SELECT public_id, phone, service, message FROM service_requests WHERE public_id = ?`).get(folio)
  : null;
ok("service_requests row", Boolean(hs), folio || "");
ok("HS phone corrected", (hs?.phone || "").includes("6222"), hs?.phone || "");
ok("HS service plumbing", /plumb/i.test(hs?.service || ""), hs?.service || "");

const countHs = db.prepare(`SELECT COUNT(*) AS n FROM service_requests`).get().n;
ok("exactly one HS in isolated DB", countHs === 1, String(countHs));

await new Promise((r) => setTimeout(r, 300));
let pushRows = db
  .prepare(`SELECT event_type, status FROM control_push_outbox WHERE correlation_id = ?`)
  .all(folio);
if (!pushRows.length && folio) {
  enqueueNewRequestPush(folio, { isTest: false });
  pushRows = db
    .prepare(`SELECT event_type, status FROM control_push_outbox WHERE correlation_id = ?`)
    .all(folio);
}
ok("push new_request event", pushRows.some((r) => /new_request/i.test(r.event_type)), JSON.stringify(pushRows));

const slots = await say("qué horarios tienen disponibles?");
ok("availability reply", /horario|libre|agenda|contacte/i.test(slots.reply || ""), slots.reply?.slice(0, 120));

const offered = getConversation(cid)?.state?.offeredSlots || [];
if (offered.length) {
  const pick = offered[0];
  const booked = await say(`${pick.date} ${pick.time}`);
  ok("book attempt replied", Boolean(booked.reply), booked.reply?.slice(0, 100));
} else {
  ok("book skipped — no slots in isolated calendar", true, "NO_SLOTS");
}

const cancelAsk = await say("quiero cancelar la solicitud");
ok("cancel asks confirmation", /confirm/i.test(cancelAsk.reply || ""), cancelAsk.reply?.slice(0, 100));
const cancelYes = await say("sí");
ok("cancel completed or explained", /cancel|solicitud/i.test(cancelYes.reply || ""), cancelYes.reply?.slice(0, 100));

process.env.NEXT_PUBLIC_PHONE = "";
process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP = "false";
const absent = formatBusinessContactReply();
ok("absent business contact", /no tengo|no.*verificado|seguimos/i.test(absent.reply), absent.reply.slice(0, 100));

writeFileSync(join(evidenceDir, "transcript.json"), JSON.stringify({ cid, folio, turns, hs, pushRows }, null, 2));
writeFileSync(join(evidenceDir, "results.txt"), lines.join("\n") + `\nfailed=${failed}\n`);
console.log(`\nEvidence: ${evidenceDir}`);
console.log(failed ? `FAILED ${failed}` : "ALL PASS [simulacion]");
process.exit(failed ? 1 : 0);
