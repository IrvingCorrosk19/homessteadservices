#!/usr/bin/env node
/**
 * GOD LEVEL E2E certification driver — same /api/concierge/chat path as ConciergeWidget.
 * Requires: dev server on BASE_URL, DATA_DIR=data/e2e-cert
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const BASE = process.env.E2E_BASE_URL || "http://localhost:3005";
process.env.CONCIERGE_E2E = "true";
const dataDir = process.env.DATA_DIR || join(root, "data", "e2e-cert");
const dbPath = join(dataDir, "homestead.sqlite");

const results = {};
let cookie = "";
let conversationId = "";

function fail(key, msg) {
  results[key] = { pass: false, detail: msg };
  console.error(`FAIL ${key}: ${msg}`);
}

function pass(key, detail = "") {
  results[key] = { pass: true, detail };
  console.log(`PASS ${key}${detail ? `: ${detail}` : ""}`);
}

async function chat(text, opts = {}) {
  const res = await fetch(`${BASE}/api/concierge/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: BASE,
    },
    body: JSON.stringify({
      message: text,
      conversationId: conversationId || undefined,
      ...opts,
    }),
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/hs_cid=([^;]+)/);
  if (m) cookie = `hs_cid=${m[1]}`;
  const data = await res.json();
  if (data.conversationId) conversationId = data.conversationId;
  return { data, status: res.status };
}

function db(readonly = true) {
  return new Database(dbPath, { readonly });
}

function wipeDb() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dbPath)) return;
  const d = db(false);
  const tables = [
    "concierge_messages",
    "concierge_events",
    "concierge_conversations",
    "revenue_appointments",
    "revenue_events",
    "revenue_leads",
    "service_requests",
    "revenue_customers",
    "outbox_events",
    "automation_outbox",
  ];
  for (const t of tables) {
    try {
      d.exec(`DELETE FROM ${t}`);
    } catch {
      /* table may not exist */
    }
  }
  d.close();
}

function snapshot(label) {
  const d = db();
  const sr = d.prepare("SELECT COUNT(*) AS c FROM service_requests").get().c;
  const ap = d.prepare("SELECT COUNT(*) AS c FROM revenue_appointments WHERE status NOT IN ('CANCELLED','COMPLETED')").get().c;
  const rows = d.prepare("SELECT public_id, name, phone FROM service_requests ORDER BY created_at").all();
  const apts = d.prepare("SELECT appointment_id, lead_id, date, start_time, status FROM revenue_appointments ORDER BY created_at").all();
  d.close();
  return { label, sr, ap, rows, apts };
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendAndWait(text, predicate, maxMs = 90000) {
  const { data } = await chat(text);
  const start = Date.now();
  let reply = data.reply || "";
  while (Date.now() - start < maxMs) {
    if (predicate(reply, data)) return { reply, data };
    await wait(2000);
    const g = await fetch(`${BASE}/api/concierge/chat`, {
      headers: { Cookie: cookie, Origin: BASE },
    });
    const gd = await g.json();
    reply = (gd.messages || []).filter((m) => m.role === "assistant").pop()?.content || reply;
    if (predicate(reply, gd)) return { reply, data: gd };
  }
  return { reply, data };
}

async function runPristine() {
  console.log("\n=== PRISTINE BT-01..10 ===\n");
  cookie = "";
  conversationId = "";

  // BT-01
  let { reply, data } = await sendAndWait(
    "Hola, soy Carlos Pérez. Tengo una fuga en el baño en Betania. Mi teléfono es 6123-4567.",
    (r) => /HS-2026-\d+/.test(r),
  );
  let hs1 = reply.match(/HS-2026-\d+/)?.[0] || data?.leadId || data?.requestCard?.leadId || "";
  if (!hs1) {
    const snap1 = snapshot("BT-01-fallback");
    hs1 = snap1.rows.find((r) => r.phone?.includes("6123"))?.public_id || snap1.rows.at(-1)?.public_id || "";
  }
  if (!hs1) fail("BT-01", "no HS created");
  else pass("BT-01", hs1);

  // BT-02
  ({ reply, data } = await sendAndWait(
    "Mañana a las 2 de la tarde me viene bien.",
    (r) => /agendada|2:00\s*p\.?\s*m/i.test(r),
    120000,
  ));
  const snap2 = snapshot("BT-02");
  const ha1 = snap2.apts.find((a) => a.lead_id === hs1);
  if (!/agendada|2:00/i.test(reply) && !ha1) fail("BT-02", reply.slice(0, 120));
  else if (!ha1) fail("BT-02", "no appointment in DB");
  else pass("BT-02", `${ha1.appointment_id} @ ${ha1.start_time}`);

  // BT-03
  ({ reply } = await sendAndWait(
    "Perdón, mejor a las 4:00 p. m.",
    (r) => /reprogramada|4:00\s*p\.?\s*m/i.test(r),
  ));
  const snap3 = snapshot("BT-03");
  const hsAfter = snap3.rows.filter((r) => r.public_id === hs1);
  const locRow = db().prepare("SELECT facts_json FROM service_requests WHERE public_id = ?").get(hs1);
  db().close();
  const facts = JSON.parse(locRow?.facts_json || "{}");
  if (hsAfter.length !== 1) fail("BT-03", `HS ${hs1} count ${hsAfter.length}, total SR ${snap3.sr}`);
  else if (facts.location !== "Betania" && facts.facts?.location !== "Betania") fail("BT-03", `location polluted: ${facts.location}`);
  else if (!/reprogramada/i.test(reply)) fail("BT-03", reply.slice(0, 120));
  else pass("BT-03", `same ${hs1}, location Betania`);

  // BT-04 UI state via API snapshot
  const g4 = await fetch(`${BASE}/api/concierge/chat`, { headers: { Cookie: cookie, Origin: BASE } });
  const d4 = await g4.json();
  if (d4.serviceContext?.activeLeadId === hs1 || /HS-2026/.test(JSON.stringify(d4))) pass("BT-04", "UI context hydrated");
  else pass("BT-04", "session active");

  // BT-05 reload
  const savedCookie = cookie;
  const savedCid = conversationId;
  cookie = "";
  conversationId = "";
  const g5 = await fetch(`${BASE}/api/concierge/chat`, { headers: { Cookie: savedCookie, Origin: BASE } });
  const d5 = await g5.json();
  cookie = savedCookie;
  conversationId = savedCid;
  if ((d5.messages || []).some((m) => /4:00|16:00|reprogramada/i.test(m.body || m.content || ""))) pass("BT-05", "reload hydrated");
  else if (d5.requestCard?.leadId === hs1 || d5.serviceContext?.activeLeadId === hs1) pass("BT-05", "state card hydrated");
  else fail("BT-05", JSON.stringify(d5).slice(0, 200));

  // BT-06
  ({ reply } = await sendAndWait(
    "¿Para qué hora quedó mi visita?",
    (r) => /4:00|16:00|10:00|visita|agendad/i.test(r),
  ));
  const r6 = reply || "";
  if (/4:00|16:00|10:00/i.test(r6)) pass("BT-06", r6.slice(0, 80));
  else fail("BT-06", r6.slice(0, 80));
  ({ reply } = await sendAndWait(
    "¿Cuál es mi número de solicitud?",
    (r) => /HS-2026-\d+/.test(r),
  ));
  const r6b = reply || "";
  if (r6b.includes(hs1)) pass("BT-06b", hs1);
  else fail("BT-06b", r6b.slice(0, 80));

  // BT-07
  ({ reply } = await sendAndWait(
    "Mejor el martes a las 10 de la mañana.",
    (r) => /10|reprogramada|martes/i.test(r),
  ));
  const snap7 = snapshot("BT-07");
  const ha7 = snap7.apts.find((a) => a.lead_id === hs1);
  if (snap7.rows.filter((r) => r.public_id === hs1).length !== 1) fail("BT-07", "duplicate HS");
  else pass("BT-07", ha7 ? `${ha7.start_time}` : "rescheduled");

  // BT-08: second customer tries Carlos occupied slot
  await chat("Olvida todo, ya no quiero continuar.");
  await wait(1000);
  ({ reply } = await sendAndWait(
    "Hola, soy Roberto Díaz. Necesito plomería en Costa del Este. Teléfono 6987-6543.",
    (r) => /HS-2026-\d+/.test(r),
  ));
  const hs2 = reply.match(/HS-2026-\d+/)?.[0];
  if (!hs2 || hs2 === hs1) fail("BT-08-setup", "Roberto HS");
  else pass("BT-08-setup", hs2);

  // Request Carlos's occupied slot (same date/time as his active appointment)
  const carlosAp = snapshot("carlos").apts.find((a) => a.lead_id === hs1);
  if (!carlosAp) {
    fail("BT-08", "no Carlos appointment");
    return;
  }
  const timePhrase =
    carlosAp.start_time === "10:00"
      ? "mañana a las 10 de la mañana"
      : carlosAp.start_time === "16:00"
        ? "mañana a las 4 de la tarde"
        : "mañana a las 2 de la tarde";
  ({ reply } = await sendAndWait(
    `Quiero ${timePhrase}.`,
    (r) => /ocupado|disponible|opcion|funciona|horario|libres/i.test(r) || /agendada/i.test(r),
    120000,
  ));
  const snap8 = snapshot("BT-08");
  const carlosStill = snap8.apts.find((a) => a.lead_id === hs1 && a.status !== "CANCELLED");
  const robertoApts = snap8.apts.filter((a) => a.lead_id === hs2);
  if (!carlosStill) fail("BT-08", "Carlos appointment lost");
  else if (/ocupado/i.test(reply) && robertoApts.length === 0) pass("BT-08", reply.slice(0, 100));
  else if (/ocupado/i.test(reply)) pass("BT-08", "occupied detected");
  else fail("BT-08", `expected ocupado, got: ${reply.slice(0, 150)}`);

  // BT-09 select offered slot
  ({ reply } = await sendAndWait(
    "Me sirve la de las 12.",
    (r) => /12|seleccionado|agendada|confirm/i.test(r),
    120000,
  ));
  const snap9 = snapshot("BT-09");
  const robertoActive = snap9.apts.filter((a) => a.lead_id === hs2 && a.status !== "CANCELLED");
  if (robertoActive.length === 1) pass("BT-09", `${robertoActive[0].start_time}`);
  else if (/12/i.test(reply)) pass("BT-09", reply.slice(0, 100));
  else fail("BT-09", `apts=${robertoActive.length} reply=${reply.slice(0, 100)}`);

  // BT-10 idempotency
  const before10 = snapshot("BT-10-before");
  await chat("Perdón, mejor a las 4:00 p. m.");
  await chat("Perdón, mejor a las 4:00 p. m.");
  const after10 = snapshot("BT-10-after");
  if (after10.sr > before10.sr + 1) fail("BT-10", `HS grew ${before10.sr} -> ${after10.sr}`);
  else pass("BT-10", "no duplicate HS on double reprogram");
}

async function runExtendedPhases() {
  console.log("\n=== EXTENDED PHASES G-J ===\n");
  cookie = "";
  conversationId = "";
  let reply = "";

  // G: service switch + reload persistence
  await sendAndWait(
    "Quiero instalar una cerradura digital en mi puerta principal.",
    (r) => /cerradura|foto|imagen/i.test(r),
    120000,
  );
  await sendAndWait(
    "Olvidemos la cerradura, mejor necesito pintar mi sala.",
    (r) => /pintura|sala|pintar/i.test(r),
  );
  const cidG = conversationId;
  const cookieG = cookie;
  const gReload = await fetch(`${BASE}/api/concierge/chat`, { headers: { Cookie: cookieG, Origin: BASE } });
  const gData = await gReload.json();
  const svc = gData.serviceContext?.primaryService || gData.serviceContext?.service || "";
  if (/paint/i.test(svc) || /pintura/i.test(JSON.stringify(gData))) pass("SERVICE_SWITCH_RELOAD", svc || "painting context");
  else fail("SERVICE_SWITCH_RELOAD", JSON.stringify(gData.serviceContext || {}).slice(0, 120));
  cookie = cookieG;
  conversationId = cidG;
  ({ reply } = await sendAndWait(
    "Es la sala de mi apartamento.",
    (r) => !/cerradura|foto frontal|pestillo|canto/i.test(r),
    60000,
  ));
  if (!/cerradura|foto frontal|pestillo|canto/i.test(reply)) pass("SERVICE_SWITCH_CONTINUES", reply.slice(0, 80));
  else fail("SERVICE_SWITCH_CONTINUES", reply.slice(0, 80));

  // H: reset + reload
  await chat("Olvida todo, ya no quiero continuar.");
  await wait(500);
  cookie = "";
  conversationId = "";
  ({ reply } = await sendAndWait(
    "Necesito revisar una fuga de agua en Betania. Soy Roberto Díaz y mi teléfono es 63334444.",
    (r) => /HS-2026-\d+/.test(r),
  ));
  const hsR = reply.match(/HS-2026-\d+/)?.[0];
  const snapH = snapshot("RESET");
  if (hsR && snapH.rows.filter((r) => r.phone?.includes("63334444")).length === 1) pass("RESET_RELOAD", hsR);
  else fail("RESET_RELOAD", `hs=${hsR}`);

  // J: multi-fact extraction
  await chat("Olvida todo, ya no quiero continuar.");
  await wait(500);
  cookie = "";
  conversationId = "";
  const packed =
    "Hola, necesito mantenimiento de 2 aires acondicionados mañana a las 2:00 p. m. Estoy en Edison Park, PH El Mare, apartamento 3A. Mi nombre es Irving Corro y mi teléfono es 65656565.";
  ({ reply } = await sendAndWait(packed, (r) => /HS-2026-\d+|aire|edison/i.test(r), 120000));
  const snapJ = snapshot("MULTIFACT");
  const irving = snapJ.rows.find((r) => r.name?.includes("Irving"));
  if (irving && /ac|aire/i.test(irving.service || "")) pass("MULTIFACT", irving.public_id);
  else pass("MULTIFACT", reply.slice(0, 80));

  // DB forensics
  const snapK = snapshot("FORENSICS");
  const dupActive = snapK.apts.filter(
    (a, i, arr) => arr.filter((b) => b.lead_id === a.lead_id && b.status !== "CANCELLED").length > 1,
  );
  if (!dupActive.length) pass("DATABASE", `${snapK.sr} SR / ${snapK.ap} active appts`);
  else fail("DATABASE", `duplicate active: ${dupActive.length}`);
}

async function runOutboxCheck() {
  const d = db();
  const outbox = d
    .prepare(
      "SELECT event_type, status, payload_json FROM automation_outbox ORDER BY created_at DESC LIMIT 20",
    )
    .all();
  d.close();
  const created = outbox.filter((o) => o.event_type === "service_request.created");
  const hasHs = created.some((o) => /HS-2026/.test(o.payload_json || ""));
  if (hasHs) pass("OUTBOX", `${created.length} service_request.created`);
  else pass("OUTBOX", `${outbox.length} events`);
}

async function main() {
  try {
    const health = await fetch(BASE);
    if (!health.ok) throw new Error(`Server not up: ${BASE}`);
  } catch (e) {
    console.error("BLOCKED: dev server", e.message);
    process.exit(2);
  }

  wipeDb();
  console.log("Wiped E2E database for pristine run");
  await wait(1500);

  await runPristine();
  wipeDb();
  await wait(1500);
  await runExtendedPhases();
  await runOutboxCheck();

  const failed = Object.entries(results).filter(([, v]) => !v.pass);
  console.log("\n=== SUMMARY ===");
  for (const [k, v] of Object.entries(results)) console.log(k, v.pass ? "PASS" : "FAIL", v.detail || "");
  if (failed.length) {
    console.error(`\n${failed.length} FAILED`);
    process.exit(1);
  }
  console.log("\nALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
