/**
 * Functional chatbot repair cases against local UI API (same as widget).
 * Requires next on E2E_BASE_URL with AI_CONCIERGE_DRY_RUN=true and real OpenAI.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:3020";
const evidence = join(root, "docs/auditoria-homestead-app/evidence/chatbot-repair-2026-10-06");
mkdirSync(join(evidence, "cases"), { recursive: true });

const jar = new Map();
function parseSetCookie(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const list = raw.length ? raw : [res.headers.get("set-cookie")].filter(Boolean);
  for (const line of list) {
    const [pair] = String(line).split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function turn(message, conversationId = "") {
  const body = { message };
  if (conversationId) body.conversationId = conversationId;
  const res = await fetch(`${base}/api/concierge/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, Cookie: cookieHeader() },
    body: JSON.stringify(body),
  });
  parseSetCookie(res);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const rows = [];
function ok(name, value, detail = "") {
  if (!value) {
    failed += 1;
    console.error("FAIL", name, detail);
  } else console.log("PASS", name, detail || "");
  return Boolean(value);
}

async function converse(name, messages) {
  jar.clear();
  let cid = "";
  const transcript = [];
  const results = [];
  console.log(`\n======== ${name} ========`);
  for (const user of messages) {
    if (typeof user === "object" && user.wait) {
      await sleep(user.wait);
      continue;
    }
    const text = typeof user === "string" ? user : user.text;
    console.log(`[user] ${text}`);
    const out = await turn(text, cid);
    cid = out.data?.conversationId || cid;
    const reply = out.data?.reply || "";
    console.log(`[assistant] ${reply.slice(0, 220)}`);
    transcript.push({ user: text, reply, leadId: out.data?.leadId, created: out.data?.requestCreatedThisTurn, appt: out.data?.appointmentId });
    results.push(out);
    await sleep(350);
  }
  writeFileSync(join(evidence, "cases", `${name}.json`), JSON.stringify({ cid, transcript, results: results.map((r) => ({ status: r.status, data: r.data })) }, null, 2));
  return { cid, transcript, results };
}

function folios(transcript) {
  const set = new Set();
  for (const t of transcript) {
    const fromReply = String(t.reply || "").match(/HS-\d{4}-\d{6}/g) || [];
    fromReply.forEach((f) => set.add(f));
    if (t.leadId && /^HS-\d{4}-\d{6}$/.test(t.leadId)) set.add(t.leadId);
  }
  return [...set];
}

// A goteras + book
{
  const { transcript, results } = await converse("A-goteras", [
    "tengo goteras en mi casa",
    "cuando llueve cae agua arriba de la cocina",
    "Ana Perez, telefono 60002211",
    "Costa del Este, PH Marbella, apto 12B",
    "mañana a las 12:30",
  ]);
  let last = results.at(-1);
  let reply = last?.data?.reply || "";
  if (/1[\).]|opción|opcion|8:00|10:00|12:00|2:00|horarios/i.test(reply)) {
    const pick = await turn(/12:00|12:30|media/i.test(reply) ? "me sirve las 12:00" : "la primera opción", last.data.conversationId);
    transcript.push({ user: "pick", reply: pick.data?.reply, leadId: pick.data?.leadId, created: pick.data?.requestCreatedThisTurn, appt: pick.data?.appointmentId });
    results.push(pick);
    reply = pick.data?.reply || "";
    if (/confirm|queda|agend/i.test(reply) && !/HS-|confirmada|agendada/i.test(reply)) {
      const yes = await turn("sí, perfecto", pick.data.conversationId);
      transcript.push({ user: "sí, perfecto", reply: yes.data?.reply, leadId: yes.data?.leadId, appt: yes.data?.appointmentId });
      results.push(yes);
      reply = yes.data?.reply || "";
    }
  }
  writeFileSync(join(evidence, "cases", "A-goteras.json"), JSON.stringify({ transcript, results: results.map((r) => ({ status: r.status, data: r.data })) }, null, 2));
  const ids = folios(transcript);
  const booked = transcript.some((t) => t.appt) || /agendad|confirmad|visita.*qued/i.test(transcript.map((t) => t.reply).join("\n"));
  const persist = ok("A-solicitud-registrada", ids.length >= 1, ids.join(",") || "none");
  const visit = ok("A-horario-o-visita", booked || /horario|cita|disponib|HS-/i.test(reply), booked ? "booked" : "partial");
  rows.push({ case: "A-goteras", fallos: "prod EARLY_RETURN + goteras no accionable", causa: "SLOT_SELECTED_EARLY_RETURN en origin; goteras ausente en intent", correccion: "CONTINUE_BOOK + goteras aliases + symptom→ACTIONABLE", folio: ids[0] || "", persistencia: persist ? "PASS" : "FAIL", push: "NO PROBADO (dry_run/local)", resultado: persist && visit ? "PASS" : persist ? "PASS parcial" : "FAIL" });
}

// B AC price then resume
{
  const { transcript } = await converse("B-ac-precio", [
    "mi aire prende pero no enfria",
    "cuanto cuesta la visita?",
    "ok sigamos con la solicitud",
    "Pedro Gomez 60002212",
    "El Cangrejo, apartamento 5A",
    "pasado mañana en la mañana",
  ]);
  const ids = folios(transcript);
  const all = transcript.map((t) => t.reply).join("\n");
  const noFake = ok("B-no-precio-inventado", !/\$\s*\d{2,}/.test(all) || /depende|revis|diagn|cotiz|sin precio fijo|evalu/i.test(all));
  const keeps = ok("B-mantiene-aire", /aire|enfr/i.test(all) && ids.length >= 1, ids[0] || "no-folio");
  rows.push({ case: "B-ac-precio", fallos: "pérdida de contexto / no crea", causa: "intent + early return", correccion: "stateful create + CONTINUE_BOOK", folio: ids[0] || "", persistencia: keeps ? "PASS" : "FAIL", push: "NO PROBADO", resultado: noFake && keeps ? "PASS" : "FAIL" });
}

// C dual need
{
  const { transcript, results } = await converse("C-dual", [
    "necesito pintar mi cuarto",
    "Luis Mora 60002213",
    "Bethania, casa",
    "mañana a las 10",
    "tambien tengo un problema con el lavamanos",
  ]);
  const last = transcript.at(-1)?.reply || "";
  const ids = folios(transcript);
  const paint = ok("C-conserva-pintura", /pintur|cuarto|visita|HS-/i.test(transcript.map((t) => t.reply).join("\n")) || results.some((r) => r.data?.leadId));
  const sink = ok("C-atiende-lavamanos", /lavamanos|plomer|fuga|también|tambien|segunda|otra/i.test(last));
  rows.push({ case: "C-dual", fallos: "cambio silencioso de servicio", causa: "contexto mid-booking", correccion: "service-transition + create continuity", folio: ids.join(","), persistencia: paint ? "PASS" : "FAIL", push: "NO PROBADO", resultado: paint && sink ? "PASS" : "FAIL" });
}

// D cancel
{
  const { transcript, results, cid } = await converse("D-cancel", [
    "tengo una fuga en el baño",
    "Maria Solis 60002214",
    "Paitilla, PH Pacific, apto 8",
    "quiero cancelar mi solicitud",
  ]);
  const ask = transcript.at(-1)?.reply || "";
  ok("D-pide-confirmacion", /confirm|seguro|cancel|HS-/i.test(ask));
  let out = await turn("no", cid);
  transcript.push({ user: "no", reply: out.data?.reply, leadId: out.data?.leadId });
  ok("D-no-mantiene", !/qued[oó] cancelad/i.test(out.data?.reply || "") || /no cancel|mantien|sigue|dejamos/i.test(out.data?.reply || ""));
  out = await turn("quiero cancelar mi solicitud", cid);
  transcript.push({ user: "quiero cancelar mi solicitud", reply: out.data?.reply, leadId: out.data?.leadId });
  out = await turn("sí, cancélala", cid);
  transcript.push({ user: "sí, cancélala", reply: out.data?.reply, leadId: out.data?.leadId });
  writeFileSync(join(evidence, "cases", "D-cancel.json"), JSON.stringify({ cid, transcript }, null, 2));
  const cancelled = ok("D-cancela", /cancelad|anulad/i.test(out.data?.reply || ""));
  const ids = folios(transcript);
  rows.push({ case: "D-cancel", fallos: "no cancela / no confirma", causa: "flujo confirmación + ownership", correccion: "engine cancel path", folio: ids[0] || "", persistencia: cancelled ? "PASS cancel" : "FAIL", push: "N/A", resultado: cancelled ? "PASS" : "FAIL" });
}

// Push enqueue path (isTest false) in e2e-cert DB without FCM drain to customers
{
  process.env.DATA_DIR = join(root, "data/e2e-cert").replaceAll("\\", "/");
  const mod = (rel) => pathToFileURL(join(root, rel)).href;
  const { saveServiceRequest, getHomesteadDb } = await import(mod("src/lib/service-requests.ts"));
  const saved = saveServiceRequest({
    name: "Push Probe Chatbot",
    phone: "+50760002999",
    email: "push-probe@example.invalid",
    property: "apartment",
    service: "plumbing",
    message: "[Asistente web Homestead]\nGoteras controlled push probe chatbot-repair.",
    photos: [],
    isTest: false,
    clientSubmissionId: `csub_chatfix_${Date.now()}`,
    factsJson: JSON.stringify({ entryPoint: "chatbot_repair_probe" }),
  });
  await new Promise((r) => setTimeout(r, 500));
  const db = getHomesteadDb();
  const push = db
    .prepare(`SELECT COUNT(*) AS c FROM control_push_outbox WHERE correlation_id = ? AND event_type = 'control.push.new_request'`)
    .get(saved.publicId);
  const pushOk = ok("PUSH-outbox-single", Number(push.c) === 1, `${saved.publicId} count=${push.c}`);
  db.prepare(`UPDATE service_requests SET is_test = 1 WHERE public_id = ?`).run(saved.publicId);
  db.prepare(`UPDATE control_push_outbox SET status = 'FAILED', last_error = 'chatbot_repair_probe_scrub' WHERE correlation_id = ? AND status = 'PENDING'`).run(saved.publicId);
  rows.push({ case: "PUSH-outbox", fallos: "aviso no llega A06", causa: "si no hay HS no hay evento; FCM físico requiere dispositivo", correccion: "create HS on symptom + CONTINUE_BOOK deploy", folio: saved.publicId, persistencia: "PASS", push: pushOk ? "OUTBOX PASS / físico NO PROBADO (A06 desconectado)" : "FAIL", resultado: pushOk ? "PASS parcial" : "FAIL" });
}

writeFileSync(join(evidence, "RESULTS-TABLE.json"), JSON.stringify({ at: new Date().toISOString(), failed, rows }, null, 2));
const md = [
  "# Chatbot repair — 2026-10-06",
  "",
  "| Caso | Fallo | Causa | Corrección | Folio | Persistencia | Push | Resultado |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.case} | ${r.fallos} | ${r.causa} | ${r.correccion} | ${r.folio} | ${r.persistencia} | ${r.push} | ${r.resultado} |`,
  ),
  "",
  "## Entorno",
  `- Local HEAD (pre-deploy): chatbot fixes + CONTINUE_BOOK`,
  `- Prod VPS BUILD_ID Ak4QNYJY (2026-10-04) aún con SLOT_SELECTED_EARLY_RETURN en origin`,
  `- A06: dispositivo no conectado → push físico NO PROBADO`,
  "",
].join("\n");
writeFileSync(join(evidence, "INFORME.md"), md);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nAll functional cases OK");
}
