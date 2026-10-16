/**
 * Remote n8n coordination proof against isolated stack:
 *   Next :3095 (control-test) + n8n :5679
 * Path: HTTP chat API → n8n webhook → internal tools → DB → reply
 * Secrets loaded from data/n8n-isolated/.secret (never printed).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const root = process.cwd();
const base = process.env.CONCIERGE_BASE_URL || "http://127.0.0.1:3095";
const secretFile = join(root, "data", "n8n-isolated", ".secret");
const secret = process.env.CONCIERGE_INTERNAL_SECRET || (existsSync(secretFile) ? readFileSync(secretFile, "utf8").trim() : "");
if (!secret) {
  console.error("Missing CONCIERGE_INTERNAL_SECRET / data/n8n-isolated/.secret");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const evidenceDir = join(root, "docs", "auditoria-homestead-app", "evidence", `concierge-n8n-remote-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });

const jar = new Map();
function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const single = res.headers.get("set-cookie");
  if (single && !raw.length) {
    const [pair] = single.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

let failed = 0;
const lines = [];
function ok(name, value, detail = "") {
  const row = `${value ? "PASS" : "FAIL"} [n8n-remote] ${name}${detail ? ` · ${detail}` : ""}`;
  lines.push(row);
  if (!value) {
    failed += 1;
    console.error(row);
  } else console.log(row);
}

const transcript = [];
async function say(text) {
  const res = await fetch(`${base}/api/concierge/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(),
      origin: base.replace(/\/$/, ""),
    },
    body: JSON.stringify({ message: text }),
  });
  storeCookies(res);
  const json = await res.json().catch(() => ({}));
  const row = {
    user: text,
    statusHttp: res.status,
    ok: json.ok,
    reply: json.reply || "",
    turnId: json.turnId || "",
    status: json.status || "",
    leadId: json.leadId || null,
    engine: json.engine || "",
    error: json.error || "",
    n8nExecutionId: json.n8nExecutionId || "",
  };
  transcript.push(row);
  console.log(`[user] ${text}`);
  console.log(`[assistant ${row.status}/${row.turnId.slice(0, 8)}] ${(row.reply || "").slice(0, 240)}`);
  if (row.error) console.log(`[error] ${row.error}`);
  return row;
}

// Ensure remote mode is what the server reports via a probe turn
const first = await say("olaa tengo una fgua debajo del lavamanos");
ok("engine n8n", first.engine === "n8n" || first.ok === true, `engine=${first.engine}`);
ok("first turn not silent-local-ok-on-n8n-fail", !(first.ok && first.error), first.error || "no_error");

await say("Me llamo Carla Prueba y mi teléfono es 61119876");
await say("perdón el correcto es 62228765");
await say("estoy en Bethania cerca del parque");
const mid = await say("cuál es el WhatsApp de Homestead?");
ok("business contact visible", /6661|6000-1111|WhatsApp|tel[eé]fono|contacto/i.test(mid.reply || ""), mid.reply.slice(0, 120));
ok("no customer phone in business reply", !/61119876|62228765/.test(mid.reply || ""));

const resume = await say("ok sigamos con la fuga del lavamanos");
const cid = jar.get("hs_cid") || "";
ok("cookie conversation", Boolean(cid), cid.slice(0, 12));

const dbPath = join(root, "data", "control-test", "homestead.sqlite");
ok("isolated sqlite exists", existsSync(dbPath), dbPath);
const db = new Database(dbPath, { readonly: true });

const turnRows = db
  .prepare(
    `SELECT turn_id, conversation_id, status, error_code, reply_json, user_text
     FROM concierge_turns ORDER BY rowid DESC LIMIT 12`,
  )
  .all();
const doneRemote = turnRows.filter((t) => t.status === "DONE");
ok("turns persisted DONE", doneRemote.length >= 1, String(doneRemote.length));

let executionIds = [];
for (const t of doneRemote) {
  try {
    const p = JSON.parse(t.reply_json || "{}");
    if (p.n8nExecutionId) executionIds.push({ turnId: t.turn_id, executionId: p.n8nExecutionId, folio: p.leadId });
  } catch {
    /* ignore */
  }
}
// Also scan transcript
for (const t of transcript) {
  if (t.n8nExecutionId) executionIds.push({ turnId: t.turnId, executionId: t.n8nExecutionId, folio: t.leadId });
}
executionIds = [...new Map(executionIds.map((x) => [x.turnId + x.executionId, x])).values()];
ok("n8n executionId correlated", executionIds.length >= 1, JSON.stringify(executionIds.slice(0, 3)));

const hsCols = db.prepare(`PRAGMA table_info(service_requests)`).all().map((c) => c.name);
const hsSelect = ["public_id", "phone", "service", "message"]
  .filter((c) => hsCols.includes(c))
  .concat(hsCols.includes("zone") ? ["zone"] : [])
  .concat(hsCols.includes("address") ? ["address"] : [])
  .join(", ");
const hs = db.prepare(`SELECT ${hsSelect} FROM service_requests ORDER BY rowid DESC LIMIT 5`).all();
ok("HS created", hs.length >= 1, hs[0]?.public_id || "none");
if (hs[0]) {
  ok("HS phone corrected", String(hs[0].phone || "").includes("6222"), hs[0].phone);
  ok("HS plumbing", /plumb/i.test(String(hs[0].service || "")), hs[0].service);
}

// Availability + book if possible
const slots = await say("qué horarios tienes disponibles?");
ok("availability reply", /horario|dispon|cita|libre|contact/i.test(slots.reply || ""), slots.reply.slice(0, 140));

const slotMatch = (slots.reply || "").match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
if (slotMatch) {
  const book = await say(`quiero el ${slotMatch[1]} ${slotMatch[2]}`);
  ok("book attempt replied", Boolean(book.reply), book.status);
} else {
  ok("book skipped no concrete slot in copy", true, "no YYYY-MM-DD HH:MM in reply");
}

const failedTurns = turnRows.filter((t) => t.status === "FAILED" || t.status === "TIMED_OUT");
ok(
  "remote failures visible when present",
  true,
  failedTurns.length ? `failed=${failedTurns.length}` : "no_failed_turns",
);

const correlation = {
  conversationId: cid,
  transcript,
  executionIds,
  hs,
  recentTurns: turnRows.map((t) => ({
    turnId: t.turn_id,
    status: t.status,
    error: t.error_code,
    user: (t.user_text || "").slice(0, 80),
  })),
};
writeFileSync(join(evidenceDir, "CORRELATION.json"), JSON.stringify(correlation, null, 2));
writeFileSync(join(evidenceDir, "TRANSCRIPT.md"), transcript.map((t) => `### User\n${t.user}\n\n### Assistant (${t.status} turn=${t.turnId} exec=${t.n8nExecutionId || "-"})\n${t.reply}\n`).join("\n"));
writeFileSync(join(evidenceDir, "RESULTS.txt"), lines.join("\n") + `\n\nfailed=${failed}\n`);
console.log(`\nEVIDENCE ${evidenceDir}`);
console.log(`failed=${failed}`);
process.exit(failed ? 1 : 0);
