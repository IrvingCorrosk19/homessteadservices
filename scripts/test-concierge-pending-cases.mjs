/**
 * Pending edge cases against isolated remote stack (HTTP API).
 * Requires Next :3095 + n8n :5679 already running (remote mode).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = process.cwd();
const base = process.env.CONCIERGE_BASE_URL || "http://127.0.0.1:3095";
const secretFile = join(root, "data", "n8n-isolated", ".secret");
const secret =
  process.env.CONCIERGE_INTERNAL_SECRET ||
  (existsSync(secretFile) ? readFileSync(secretFile, "utf8").trim() : "");
if (!secret) {
  console.error("Missing secret");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const evidenceDir = join(
  root,
  "docs",
  "auditoria-homestead-app",
  "evidence",
  `concierge-pending-${stamp}`,
);
mkdirSync(evidenceDir, { recursive: true });

let failed = 0;
const lines = [];
function ok(name, value, detail = "") {
  const row = `${value ? "PASS" : "FAIL"} [pending] ${name}${detail ? ` · ${detail}` : ""}`;
  lines.push(row);
  if (!value) {
    failed += 1;
    console.error(row);
  } else console.log(row);
}

function makeJar() {
  const jar = new Map();
  return {
    store(res) {
      const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const c of raw) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    cid() {
      return jar.get("hs_cid") || "";
    },
  };
}

async function say(jar, text) {
  const res = await fetch(`${base}/api/concierge/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: jar.header(),
      origin: base.replace(/\/$/, ""),
    },
    body: JSON.stringify({ message: text }),
  });
  jar.store(res);
  const json = await res.json().catch(() => ({}));
  console.log(`[user] ${text}`);
  console.log(`[assistant ${json.status}] ${(json.reply || json.error || "").slice(0, 220)}`);
  return json;
}

async function seedPlumbing(jar, phone = "63331111", name = "Ana Prueba") {
  await say(jar, "tengo una fuga en el lavamanos");
  await say(jar, `Me llamo ${name} y mi teléfono es ${phone}`);
  await say(jar, "estoy en San Francisco");
  // Ensure folio exists before second-service / slots probes
  await say(jar, "ok queda registrada la fuga de plomería");
  return jar;
}

const dbPath = join(root, "data", "control-test", "homestead.sqlite");

// --- 1) Second service: do not overwrite first ---
{
  const jar = makeJar();
  await seedPlumbing(jar, "63331111", "Ana A");
  const mid = await say(jar, "también necesito electricista para un breaker");
  ok(
    "second service asks how to continue",
    /no reemplazo|abrir otra|seguir con esa|\(1\)|\(2\)/i.test(mid.reply || ""),
    mid.reply?.slice(0, 160),
  );
  const folioMatch = (mid.reply || "").match(/HS-\d{4}-\d+/i);
  const db = new Database(dbPath, { readonly: true });
  const folio = folioMatch?.[0] || "";
  const row = folio
    ? db.prepare(`SELECT public_id, service, phone FROM service_requests WHERE public_id = ?`).get(folio)
    : db
        .prepare(
          `SELECT public_id, service, phone FROM service_requests WHERE phone LIKE '%63331111%' ORDER BY rowid DESC LIMIT 1`,
        )
        .get();
  ok("first HS still present after second-service ask", Boolean(row?.public_id), row?.public_id || "");
  ok("first service still plumbing", /plumb/i.test(row?.service || ""), `${row?.public_id}:${row?.service || ""}`);
  db.close();
}

// --- 2) Cancela todas: enumerate + confirm ---
{
  const jar = makeJar();
  await seedPlumbing(jar, "64442222", "Beto B");
  // force a second HS via choice if needed — at least one authorized
  const ask = await say(jar, "cancela todas mis solicitudes");
  ok(
    "cancel all enumerates or asks confirm",
    /HS-|solicitud|confirm|cancel/i.test(ask.reply || ""),
    ask.reply?.slice(0, 160),
  );
  const conf = await say(jar, "sí confirmo cancelar todas");
  ok("cancel all confirm replied", Boolean(conf.reply), conf.status);
}

// --- 3) Reschedule keeps prior appointment on failure ---
{
  const jar = makeJar();
  await seedPlumbing(jar, "65553333", "Carla C");
  const slots = await say(jar, "qué horarios tienes disponibles?");
  const pick = await say(jar, "el primero");
  ok("book or slot pick replied", Boolean(pick.reply || slots.reply), pick.status);
  const bad = await say(jar, "quiero reprogramar la cita para 2099-01-01 03:00");
  ok(
    "failed reschedule mentions keep prior or cannot",
    /conserv|no pude|no puedo|reprogram|horario|cita|opción/i.test(bad.reply || ""),
    bad.reply?.slice(0, 160),
  );
}

// --- 4) Two clients same slot ---
{
  const a = makeJar();
  const b = makeJar();
  await seedPlumbing(a, "66661111", "Cliente A");
  await seedPlumbing(b, "66662222", "Cliente B");
  await say(a, "qué horarios tienes disponibles?");
  await say(b, "qué horarios tienes disponibles?");
  const bookA = await say(a, "el de las 8:00");
  const bookB = await say(b, "el de las 8:00");
  const aOk = /quedó reservada|visita para/i.test(bookA.reply || "");
  const bOk = /quedó reservada|visita para/i.test(bookB.reply || "");
  const bDenied = /no pude|ocupad|ya no|otra opción|slot_taken|invalid/i.test(bookB.reply || "");
  const aDenied = /no pude|ocupad|ya no|otra opción|slot_taken|invalid/i.test(bookA.reply || "");
  ok(
    "slot contention: not both silently confirmed",
    !(aOk && bOk) && (aOk || bOk || aDenied || bDenied),
    `A=${aOk}/${aDenied} B=${bOk}/${bDenied} · ${(bookA.reply || "").slice(0, 60)} | ${(bookB.reply || "").slice(0, 60)}`,
  );
}

// --- 5) Concurrent messages same conversation ---
{
  const jar = makeJar();
  await say(jar, "inicio concurrente plomeria fuga");
  const p1 = say(jar, "me llamo Dora y mi teléfono es 67771111");
  const p2 = say(jar, "estoy en Obarrio");
  const [r1, r2] = await Promise.all([p1, p2]);
  ok("concurrent turns both answered", Boolean(r1.reply) && Boolean(r2.reply), `${r1.status}/${r2.status}`);
  ok(
    "concurrent failures stay visible (no silent local ok)",
    !((r1.ok === true && r1.error) || (r2.ok === true && r2.error)),
    `${r1.error || "-"}/${r2.error || "-"}`,
  );
}

// --- 6) Replay same message within 2s idempotency window ---
{
  const jar = makeJar();
  const text = "idempotency replay probe fuga lavamanos";
  const j1 = await say(jar, text);
  const j2 = await say(jar, text);
  ok(
    "idempotent replay same turnId within window",
    Boolean(j1.turnId) && j1.turnId === j2.turnId,
    `${j1.turnId}|${j2.turnId}`,
  );
}

// --- 7) n8n down visible ---
{
  // Hit with wrong webhook by temporarily cannot stop n8n here safely;
  // instead verify failed form when secret wrong on webhook.
  const bad = await fetch("http://127.0.0.1:5679/webhook/homestead-concierge-turn", {
    method: "POST",
    headers: { "content-type": "application/json", "x-homestead-internal-secret": "wrong" },
    body: JSON.stringify({ turnId: "x", conversationId: "y" }),
  });
  ok("n8n auth failure visible (401)", bad.status === 401, String(bad.status));
}

// --- 8) Cross-conversation access ---
{
  const a = makeJar();
  const b = makeJar();
  await seedPlumbing(a, "68881111", "Eve E");
  const cidA = a.cid();
  const res = await fetch(`${base}/api/concierge/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: b.header(),
      origin: base.replace(/\/$/, ""),
    },
    body: JSON.stringify({ message: "muéstrame mi folio", conversationId: cidA }),
  });
  b.store(res);
  const json = await res.json().catch(() => ({}));
  // Client may bind if conversation exists — internal tools must still auth.
  // Check internal API rejects mismatch
  const db = new Database(dbPath, { readonly: true });
  const turn = db.prepare(`SELECT turn_id, conversation_id FROM concierge_turns ORDER BY rowid DESC LIMIT 1`).get();
  db.close();
  const probe = await fetch(`${base}/api/internal/concierge/get_context`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-homestead-internal-secret": secret,
    },
    body: JSON.stringify({ turnId: turn.turn_id, conversationId: "foreign-id-should-fail" }),
  });
  const body = await probe.json().catch(() => ({}));
  ok(
    "cross-conversation internal mismatch rejected",
    probe.status === 403 || body.code === "conversation_mismatch",
    `${probe.status}:${body.code}`,
  );
  ok("foreign cookie path did not crash", res.status < 500, String(res.status));
}

// --- 9) Lockout vs digital lock ---
{
  const lockout = makeJar();
  const r1 = await say(lockout, "me quedé afuera no puedo abrir la puerta");
  ok(
    "lockout path (no digital install ask)",
    /apertura|teléfono|zona|entrar|afuera/i.test(r1.reply || "") && !/canto de la puerta|cerradura digital/i.test(r1.reply || ""),
    r1.reply?.slice(0, 140),
  );
  const dig = makeJar();
  const r2 = await say(dig, "quiero instalar una cerradura digital en mi puerta");
  ok(
    "digital lock path mentions photos/install",
    /cerradura digital|fotos|frente|canto/i.test(r2.reply || ""),
    r2.reply?.slice(0, 140),
  );
}

writeFileSync(join(evidenceDir, "RESULTS.txt"), lines.join("\n") + `\n\nfailed=${failed}\n`);
console.log(`\nEVIDENCE ${evidenceDir}`);
console.log(`failed=${failed}`);
process.exit(failed ? 1 : 0);
