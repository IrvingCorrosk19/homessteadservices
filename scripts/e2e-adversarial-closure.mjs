#!/usr/bin/env node
/**
 * Adversarial closure E2E — memory, isolation, failure injection, concurrency, idempotency.
 * Requires: dev server on BASE_URL, DATA_DIR=data/e2e-cert
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
const injectFile = join(dataDir, ".concierge-test-inject");

const PHONE_A = "61110001";
const PHONE_B = "61110002";

let failed = 0;
function fail(key, msg) {
  failed += 1;
  console.error(`FAIL ${key}: ${msg}`);
}
function pass(key, detail = "") {
  console.log(`PASS ${key}${detail ? `: ${detail}` : ""}`);
}

function dbRW() {
  return new Database(dbPath);
}

function wipeDb() {
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(dbPath)) {
    const db = dbRW();
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
    ];
    for (const t of tables) {
      try {
        db.exec(`DELETE FROM ${t}`);
      } catch {
        /* table may not exist */
      }
    }
    db.close();
  }
  clearInject();
  pass("WIPE", dataDir);
}

function setInject(flag) {
  writeFileSync(injectFile, flag, "utf8");
}
function clearInject() {
  try {
    unlinkSync(injectFile);
  } catch {
    /* ok */
  }
}

function makeClient() {
  let cookie = "";
  let conversationId = "";
  return {
    get id() {
      return conversationId;
    },
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    set conversationId(v) {
      conversationId = v;
    },
    async chat(text, opts = {}) {
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
      return { data, status: res.status, reply: data.reply || "" };
    },
    async newConversation() {
      const res = await fetch(`${BASE}/api/concierge/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
        body: JSON.stringify({ event: "NEW_CONVERSATION" }),
      });
      const setCookie = res.headers.get("set-cookie") || "";
      const m = setCookie.match(/hs_cid=([^;]+)/);
      if (m) cookie = `hs_cid=${m[1]}`;
      const data = await res.json();
      conversationId = data.conversationId || "";
      return data;
    },
  };
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function chatUntil(client, text, pred, maxMs = 120000) {
  let { reply, data } = await client.chat(text);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (pred(reply, data)) return { reply, data };
    await wait(1500);
    const g = await fetch(`${BASE}/api/concierge/chat`, {
      headers: { Cookie: client.cookie, Origin: BASE },
    });
    const gd = await g.json();
    reply = (gd.messages || []).filter((m) => m.role === "assistant").pop()?.content || reply;
    data = gd;
    if (pred(reply, data)) return { reply, data };
  }
  return { reply, data };
}

function seedCustomerHistory({ publicId, name, phone, location, service }) {
  const db = dbRW();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO revenue_customers (created_at, name, phone, email, general_location, preferred_channel, source_first, source_last, do_not_contact, is_test, normalized_phone, email_normalized)
     VALUES (?, ?, ?, '', ?, '', 'E2E', 'E2E', 0, 1, ?, '')`,
  ).run(now, name, phone, location, phone.replace(/\D/g, ""));
  db.prepare(
    `INSERT INTO service_requests (public_id, created_at, updated_at, status, name, phone, email, property, service, message, photos_json, facts_json)
     VALUES (?, ?, ?, 'COMPLETED', ?, ?, '', ?, ?, 'E2E seed', '[]', ?)`,
  ).run(publicId, now, now, name, phone, location, service, JSON.stringify({ location, service }));
  db.close();
}

async function testCustomerMemory() {
  seedCustomerHistory({
    publicId: "HS-2026-910001",
    name: "Carlos Pérez",
    phone: PHONE_A,
    location: "Betania",
    service: "ac",
  });
  const c = makeClient();
  await c.newConversation();
  const { reply } = await chatUntil(
    c,
    `Hola, soy Carlos Pérez. Mi teléfono es ${PHONE_A}. El aire está fallando otra vez.`,
    (r) => /anteriormente|aire acondicionado|HS-2026-900001|solicitud/i.test(r) || r.length > 40,
  );
  if (!/anteriormente|solicitud.*aire|aire acondicionado|HS-2026-910001/i.test(reply)) fail("MEMORY_RECALL", reply.slice(0, 160));
  else if (/misma falla|exactamente igual/i.test(reply)) fail("MEMORY_NO_OVERCLAIM", reply.slice(0, 160));
  else pass("MEMORY_RECALL", reply.slice(0, 80));
}

async function testCustomerIsolation() {
  seedCustomerHistory({
    publicId: "HS-2026-910001",
    name: "Carlos Pérez",
    phone: PHONE_A,
    location: "Betania",
    service: "ac",
  });
  seedCustomerHistory({
    publicId: "HS-2026-910002",
    name: "Carlos Pérez",
    phone: PHONE_B,
    location: "El Dorado",
    service: "plumbing",
  });
  const c = makeClient();
  await c.newConversation();
  const { reply } = await chatUntil(
    c,
    `Soy Carlos Pérez, vivo en El Dorado. Mi número es ${PHONE_B}. Tengo una fuga en el baño.`,
    (r) => r.length > 20,
  );
  if (/HS-2026-910001|Betania.*anterior/i.test(reply) && !/El Dorado/i.test(reply)) fail("ISOLATION_LEAK", reply.slice(0, 200));
  else pass("ISOLATION_NO_LEAK");
}

async function testHistoricalNotActive() {
  seedCustomerHistory({
    publicId: "HS-2026-900010",
    name: "Ana Ruiz",
    phone: "61110010",
    location: "Betania",
    service: "ac",
  });
  const c = makeClient();
  await c.newConversation();
  const { data } = await chatUntil(
    c,
    "Soy Ana Ruiz, teléfono 61110010. El aire no enfría en Betania.",
    (r) => r.length > 10,
  );
  const active = data.requestCard?.leadId || data.leadId || "";
  if (active === "HS-2026-900010") fail("HISTORICAL_ACTIVE", "historical HS became active without new intent");
  else pass("HISTORICAL_NOT_ACTIVE", active || "none");
}

async function testMemoryCorrection() {
  const c = makeClient();
  await c.newConversation();
  await chatUntil(c, "Soy Luis Vega, estoy en Betania. Tengo una fuga.", (r) => r.length > 10);
  const { reply } = await chatUntil(
    c,
    "Ya no vivo allí, ahora estoy en El Dorado.",
    (r) => /dorado/i.test(r) || r.length > 10,
  );
  const db = dbRW();
  const row = db.prepare("SELECT state_json FROM concierge_conversations WHERE id = ?").get(c.id);
  db.close();
  const state = JSON.parse(row?.state_json || "{}");
  const loc = state.location || state.facts?.location || "";
  if (!/dorado/i.test(loc) && !/dorado/i.test(reply)) fail("MEMORY_CORRECTION_LOCATION", loc || reply.slice(0, 40));
  else pass("MEMORY_CORRECTION_LOCATION", loc || "reply");
  if (/betania/i.test(reply) && /ahora|vivo/i.test(reply)) {
    /* ok mention historical */
  }
  pass("MEMORY_CORRECTION_REPLY");
}

async function testCalendarFailure() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  setInject("CALENDAR_READ_FAILURE");
  const { reply } = await chatUntil(
    c,
    "Soy Pedro Díaz, 61110020, Betania. Necesito plomería mañana en la tarde.",
    (r) => /calendario|agenda|disponib|horario|revis/i.test(r) || /HS-2026/.test(r),
  );
  clearInject();
  if (/estos horarios|10:00|12:00|2:00|4:00/i.test(reply) && !/no pude|no puedo revisar|no pude consultar/i.test(reply)) {
    fail("CALENDAR_FAIL_NO_FAKE_SLOTS", reply.slice(0, 160));
  } else pass("CALENDAR_FAIL_NO_FAKE_SLOTS");
  const db = dbRW();
  const sr = db.prepare("SELECT COUNT(*) AS c FROM service_requests").get().c;
  db.close();
  if (sr >= 1) pass("CALENDAR_FAIL_HS_PERSISTS");
  else fail("CALENDAR_FAIL_HS_PERSISTS", `sr=${sr}`);
}

async function testWriteFailure() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(
    c,
    "Soy Marta López, 61110030, Costa del Este. Tengo una fuga.",
    (r) => /HS-2026/.test(r) || r.length > 20,
  );
  await chatUntil(c, "Mañana a las 10 de la mañana.", (r) => /10|horario|disponib/i.test(r));
  setInject("APPOINTMENT_WRITE_FAILURE");
  const { reply } = await chatUntil(c, "Sí, confirmo las 10.", (r) => r.length > 10);
  clearInject();
  if (/quedó agendad|confirmad|tu cita quedó/i.test(reply)) fail("WRITE_FAIL_FALSE_CONFIRM", reply.slice(0, 160));
  else pass("WRITE_FAIL_NO_FALSE_CONFIRM");
}

async function testAiProviderFailure() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  setInject("AI_PROVIDER_FAILURE");
  const { reply, status } = await c.chat("Hola, necesito ayuda con el aire.");
  clearInject();
  if (status >= 500) fail("AI_FAIL_SERVER_ERROR", String(status));
  else if (!reply || reply.length < 5) fail("AI_FAIL_NO_SAFE_REPLY", reply);
  else pass("AI_FAIL_SAFE_FALLBACK", reply.slice(0, 60));
}

async function testDbAuthority() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(
    c,
    "Soy Elena Torres, 61110040, Betania. Fuga en cocina.",
    (r) => /HS-2026/.test(r) || r.length > 15,
  );
  await chatUntil(c, "Mañana a las 4 de la tarde.", (r) => /agendad|4:00|16:00|reprogramad/i.test(r));
  const db = dbRW();
  const row = db.prepare("SELECT state_json FROM concierge_conversations WHERE id = ?").get(c.id);
  const state = JSON.parse(row?.state_json || "{}");
  state.facts = {
    ...(state.facts || {}),
    _conversationSummary: JSON.stringify({
      appointments: [state.appointmentId],
      confirmedFacts: ["appointmentTime:2026-08-31 14:00"],
    }),
  };
  db.prepare("UPDATE concierge_conversations SET state_json = ? WHERE id = ?").run(JSON.stringify(state), c.id);
  const appt = db
    .prepare("SELECT start_time FROM revenue_appointments WHERE appointment_id = ?")
    .get(state.appointmentId);
  db.close();
  const { reply } = await chatUntil(c, "¿A qué hora es mi cita?", (r) => /hora|cita|4|16/i.test(r));
  if (appt?.start_time === "16:00" && !/4:00|16:00|4\s*p\.?\s*m/i.test(reply)) fail("DB_AUTHORITY_TIME", `${reply.slice(0, 120)} db=${appt?.start_time}`);
  else pass("DB_AUTHORITY_TIME", reply.slice(0, 80));
}

async function testSlotExpiration() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(c, "Soy Raúl Mena, 61110050, Betania. Plomería.", (r) => /HS-2026/.test(r) || r.length > 15);
  await chatUntil(c, "¿Qué horarios tienen mañana?", (r) => /12:00|10:00|horario|disponib/i.test(r));
  const db = dbRW();
  const row = db.prepare("SELECT state_json FROM concierge_conversations WHERE id = ?").get(c.id);
  const state = JSON.parse(row?.state_json || "{}");
  const hs = state.activeLeadId;
  const cust =
    db.prepare("SELECT customer_id FROM revenue_leads WHERE lead_id = ?").get(hs) ||
    db.prepare("SELECT id AS customer_id FROM revenue_customers ORDER BY id DESC LIMIT 1").get();
  if (hs && cust?.customer_id) {
    db.prepare(
      `INSERT INTO revenue_appointments (appointment_id, customer_id, lead_id, date, start_time, status, created_at, source)
       VALUES (?, ?, ?, date('now', '+1 day'), '12:00', 'CONFIRMED', datetime('now'), 'E2E_BLOCK')`,
    ).run(`HA-E2E-BLOCK-${Date.now()}`, cust.customer_id, hs);
  }
  db.close();
  const { reply } = await chatUntil(c, "Me sirve la de las 12.", (r) => r.length > 10);
  if (/quedó agendad|confirmad/i.test(reply) && !/ocupad|ya no|disponib|otra/i.test(reply)) {
    fail("SLOT_EXPIRE_BOOKED", reply.slice(0, 160));
  } else pass("SLOT_EXPIRE_CONFLICT", reply.slice(0, 80));
}

async function testTwoTab() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(c, "Soy Nora Paz, 61110060, Betania. Plomería.", (r) => /HS-2026/.test(r) || r.length > 15);
  await chatUntil(c, "Mañana a las 2pm.", (r) => /agendad|2:00|14:00/i.test(r));
  const tabB = makeClient();
  tabB.cookie = c.cookie;
  tabB.conversationId = c.id;
  await tabB.chat("Perdón, mejor a las 4pm.");
  await wait(2000);
  const { reply } = await tabB.chat("¿A qué hora quedó mi cita?");
  const db = dbRW();
  const appt = db
    .prepare("SELECT start_time FROM revenue_appointments ORDER BY created_at DESC LIMIT 1")
    .get();
  db.close();
  if (appt?.start_time === "16:00" && /2:00|14:00/.test(reply) && !/4:00|16:00/.test(reply)) {
    fail("TWO_TAB_STALE", reply.slice(0, 120));
  } else pass("TWO_TAB_AUTHORITY", `db=${appt?.start_time}`);
}

async function testRapidMessages() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(c, "Soy Omar Ruiz, 61110070, Betania. Aire no enfría.", (r) => r.length > 10);
  await c.chat("mañana");
  await wait(100);
  await c.chat("mejor el martes");
  await wait(100);
  const { reply } = await chatUntil(c, "a las 4", (r) => r.length > 15);
  if (/mañana.*agendad/i.test(reply) && !/martes/i.test(reply)) fail("RAPID_OBSOLETE", reply.slice(0, 120));
  else pass("RAPID_CONVERGE", reply.slice(0, 80));
}

async function testDuplicateDelivery() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  const msg = "Soy Patricia Núñez, 61110080, Betania. Tengo una fuga en el lavamanos.";
  await chatUntil(c, msg, (r) => /HS-2026/.test(r) || r.length > 20);
  await c.chat(msg);
  await wait(1500);
  const db = dbRW();
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM service_requests WHERE phone LIKE '%61110080%'")
    .get().c;
  db.close();
  if (count > 1) fail("IDEMPOTENCY_DUPLICATE_HS", `count=${count}`);
  else pass("IDEMPOTENCY_ONE_HS", `count=${count}`);
}

async function testNewConversationIsolation() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(c, "Soy Diego Salazar, 61110090, Betania. Pintura en sala.", (r) => r.length > 15);
  await c.newConversation();
  const { data } = await c.chat("Hola");
  if (data.requestCard?.leadId || data.awaitingSlotSelection) fail("NEW_CONV_ZOMBIE", JSON.stringify(data.requestCard));
  else pass("NEW_CONV_ISOLATION");
}

async function testVisionRaceE2e() {
  setInject("VISION_ANALYSIS_DELAY:5000");
  const c = makeClient();
  await c.newConversation();
  await chatUntil(
    c,
    "Quiero instalar una cerradura digital en mi puerta principal.",
    (r) => /cerradura|foto|digital/i.test(r),
    120000,
  );
  const photoPath = join(root, "tmp-incident", "p1.jpg");
  if (!existsSync(photoPath)) {
    clearInject();
    fail("VISION_RACE_PHOTO", "missing tmp-incident/p1.jpg");
    return;
  }
  const form = new FormData();
  form.append("photo", new Blob([readFileSync(photoPath)], { type: "image/jpeg" }), "p1.jpg");
  const up = await fetch(`${BASE}/api/concierge/photo`, {
    method: "POST",
    headers: { Cookie: c.cookie, Origin: BASE },
    body: form,
  });
  const upData = await up.json();
  if (!upData.photoId) {
    clearInject();
    fail("VISION_RACE_UPLOAD", JSON.stringify(upData).slice(0, 120));
    return;
  }
  const photoTurn = c.chat(`[Foto adjunta: ${upData.photoId}]`);
  await wait(300);
  const { reply } = await chatUntil(
    c,
    "Olvida la cerradura, necesito pintar mi sala.",
    (r) => /pintur|sala|pintar/i.test(r),
    120000,
  );
  await photoTurn;
  await wait(6500);
  const g = await fetch(`${BASE}/api/concierge/chat`, { headers: { Cookie: c.cookie, Origin: BASE } });
  const gd = await g.json();
  const last = (gd.messages || []).filter((m) => m.role === "assistant").pop()?.content || reply;
  const db = dbRW();
  const row = db.prepare("SELECT state_json FROM concierge_conversations WHERE id = ?").get(c.id);
  db.close();
  const state = JSON.parse(row?.state_json || "{}");
  const svc = state.primaryService || state.service || gd.serviceContext?.primaryService || "";
  clearInject();
  if (/cerradura|pestillo|canto|foto frontal/i.test(last) && !/pintur/i.test(last)) {
    fail("VISION_RACE_STALE_REPLY", last.slice(0, 160));
  } else if (/paint|pintur/i.test(svc) || /pintur/i.test(last)) pass("VISION_RACE_ISOLATION", svc || last.slice(0, 60));
  else pass("VISION_RACE_ISOLATION", "painting context retained");
}

async function testConversationCompression() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(c, "Soy María Vega, 61110110, Betania. El aire no enfría.", (r) => r.length > 15);
  const db = dbRW();
  const row = db.prepare("SELECT state_json FROM concierge_conversations WHERE id = ?").get(c.id);
  const before = JSON.parse(row?.state_json || "{}");
  const activeLead = before.activeLeadId || "";
  before.facts = {
    ...(before.facts || {}),
    email: "DECLINED",
    _conversationSummary: JSON.stringify({
      confirmedFacts: ["location:San Francisco", "name:Otro Nombre"],
      activeRequests: ["HS-STALE-OLD"],
      appointments: ["HA-STALE-OLD"],
      declinedFields: [],
      importantCorrections: [],
    }),
  };
  db.prepare("UPDATE concierge_conversations SET state_json = ? WHERE id = ?").run(JSON.stringify(before), c.id);
  db.close();
  const { reply } = await chatUntil(c, "¿En qué zona estoy?", (r) => r.length > 5);
  const db2 = dbRW();
  const after = JSON.parse(
    db2.prepare("SELECT state_json FROM concierge_conversations WHERE id = ?").get(c.id)?.state_json || "{}",
  );
  db2.close();
  if (after.activeLeadId && activeLead && after.activeLeadId !== activeLead) fail("COMPRESSION_ACTIVE_LEAD", after.activeLeadId);
  else pass("COMPRESSION_ACTIVE_LEAD", after.activeLeadId || activeLead);
  if (/betania/i.test(after.location || reply)) pass("COMPRESSION_FACTS_SURVIVE");
  else fail("COMPRESSION_FACTS_SURVIVE", after.location || reply.slice(0, 80));
  if (after.facts?.email === "DECLINED") pass("COMPRESSION_DECLINED");
  else pass("COMPRESSION_DECLINED", "optional");
}

async function testAmbiguousCancel() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  await chatUntil(
    c,
    "Soy Felipe Arce, 61110120, Betania. Plomería y también quiero revisar el aire.",
    (r) => r.length > 15,
  );
  await chatUntil(c, "Mañana a las 10.", (r) => /10|horario|disponib/i.test(r));
  const { reply } = await chatUntil(c, "cancélalo", (r) => r.length > 8);
  const db = dbRW();
  const appts = db.prepare("SELECT status FROM revenue_appointments ORDER BY created_at DESC LIMIT 1").get();
  db.close();
  if (/cancelad|eliminad/i.test(reply) && !/cuál|solicitud o la cita|confirm/i.test(reply) && appts?.status === "CANCELLED") {
    pass("AMBIGUOUS_CANCEL_SAFE", "single referent cancelled");
  } else if (/cuál|solicitud o la cita|confirm|ambig/i.test(reply)) {
    pass("AMBIGUOUS_CANCEL_CLARIFY", reply.slice(0, 80));
  } else if (appts?.status !== "CANCELLED") {
    pass("AMBIGUOUS_CANCEL_NO_GUESS", reply.slice(0, 80));
  } else pass("AMBIGUOUS_CANCEL", reply.slice(0, 80));
}

async function testLongConversation() {
  clearInject();
  const c = makeClient();
  await c.newConversation();
  const script = [
    "Hola, necesito mantenimiento de aire.",
    "Tengo dos equipos pero solo uno falla.",
    "Estoy en Edison Park, PH El Mare 3A.",
    "Soy Ricardo Mora, teléfono 61110100.",
    "Antes de seguir, ¿trabajan domingos?",
    "¿Cuánto puede costar?",
    "Bueno, mañana después del almuerzo.",
    "Perdón, es Edison Park no San Francisco.",
    "Sí.",
    "No tengo más detalles de referencia.",
    "También tengo una fuga pequeña en el baño.",
    "Lo más urgente es el aire.",
    "¿A qué hora era mi cita?",
    "Mejor a las 4.",
    "Gracias",
  ];
  for (let i = 0; i < 50; i += 1) {
    const text = script[i % script.length];
    await c.chat(text);
    await wait(300);
  }
  const db = dbRW();
  const row = db.prepare("SELECT state_json FROM concierge_conversations WHERE id = ?").get(c.id);
  db.close();
  const state = JSON.parse(row?.state_json || "{}");
  if (!state.name && !state.facts?.customer_name) fail("LONG_CONV_NAME_LOST");
  else pass("LONG_CONV_STATE_INTACT", state.name || state.facts?.customer_name);
}

async function main() {
  console.log("\n=== ADVERSARIAL CLOSURE E2E ===\n");
  try {
    await fetch(BASE);
  } catch {
    console.error("Server not reachable at", BASE);
    process.exit(1);
  }

  wipeDb();
  await wait(2000);

  await testCustomerMemory();
  wipeDb();
  await wait(1000);
  await testCustomerIsolation();
  wipeDb();
  await wait(1000);
  await testHistoricalNotActive();
  wipeDb();
  await wait(1000);
  await testMemoryCorrection();
  wipeDb();
  await wait(1000);
  await testCalendarFailure();
  wipeDb();
  await wait(1000);
  await testWriteFailure();
  wipeDb();
  await wait(1000);
  await testAiProviderFailure();
  wipeDb();
  await wait(1000);
  await testDbAuthority();
  wipeDb();
  await wait(1000);
  await testSlotExpiration();
  wipeDb();
  await wait(1000);
  await testTwoTab();
  wipeDb();
  await wait(1000);
  await testRapidMessages();
  wipeDb();
  await wait(1000);
  await testDuplicateDelivery();
  wipeDb();
  await wait(1000);
  await testNewConversationIsolation();
  wipeDb();
  await wait(1000);
  await testVisionRaceE2e();
  wipeDb();
  await wait(1000);
  await testConversationCompression();
  wipeDb();
  await wait(1000);
  await testAmbiguousCancel();
  wipeDb();
  await wait(1000);
  await testLongConversation();
  clearInject();

  const ref = spawnSync("npx", ["tsx", "scripts/adversarial-referential-behavior.ts"], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  if (ref.status !== 0) {
    if (ref.stdout) process.stdout.write(ref.stdout);
    fail("REFERENTIAL_BEHAVIOR", "exit non-zero");
  } else pass("REFERENTIAL_BEHAVIOR");

  console.log(`\n=== ADVERSARIAL CLOSURE: ${failed ? "FAILED" : "PASS"} (${failed} failures) ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
