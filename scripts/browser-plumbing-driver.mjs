/**
 * Drives plumbing journey via real HTTP against the same origin the browser uses,
 * after the widget already created the cookie (pass COOKIE=hs_cid=...).
 * Prefer full UI when possible; this records transcript for correlation.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const base = process.env.CONCIERGE_BASE_URL || "http://127.0.0.1:3095";
const cookie = process.env.HS_CID_COOKIE || "";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const evidenceDir = join(
  process.cwd(),
  "docs",
  "auditoria-homestead-app",
  "evidence",
  `concierge-browser-plumbing-${stamp}`,
);
mkdirSync(evidenceDir, { recursive: true });

const jar = cookie ? cookie : "";
let cookieHeader = jar.includes("=") ? jar : jar ? `hs_cid=${jar}` : "";

async function say(text) {
  const res = await fetch(`${base}/api/concierge/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      origin: base.replace(/\/$/, ""),
    },
    body: JSON.stringify({ message: text }),
  });
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const [pair] = c.split(";");
    if (pair.startsWith("hs_cid=")) cookieHeader = pair;
  }
  const json = await res.json().catch(() => ({}));
  console.log("USER:", text);
  console.log("ASSISTANT:", (json.reply || json.error || "").slice(0, 300));
  return json;
}

const steps = [
  "perdón el correcto es 62228765",
  "estoy en Bethania cerca del parque",
  "cuál es el WhatsApp de Homestead?",
  "ok sigamos con la fuga",
  "qué horarios tienes disponibles?",
  "el primero",
  "reprograma para el segundo",
  "cancela la cita",
  "sí",
];

const transcript = [];
for (const s of steps) {
  transcript.push({ user: s, ...(await say(s)) });
}

const db = new Database(join(process.cwd(), "data", "control-test", "homestead.sqlite"), {
  readonly: true,
});
const hs = db.prepare(`SELECT public_id, phone, service, status FROM service_requests ORDER BY rowid DESC LIMIT 3`).all();
const turns = db
  .prepare(
    `SELECT turn_id, status, substr(user_text,1,60) u, substr(reply_json,1,120) r FROM concierge_turns ORDER BY rowid DESC LIMIT 15`,
  )
  .all();
db.close();

writeFileSync(join(evidenceDir, "TRANSCRIPT.json"), JSON.stringify({ cookieHeader, transcript, hs, turns }, null, 2));
console.log("EVIDENCE", evidenceDir);
console.log("HS", hs);
