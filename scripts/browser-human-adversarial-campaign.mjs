#!/usr/bin/env node
/**
 * Human-style adversarial campaign (10+ conversations) via same /api/concierge/chat path as Browser Tab widget.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
const outDir = join(dataDir, "adversarial-campaign");
const outFile = join(outDir, "campaign-log.json");

const SCENARIOS = [
  {
    id: "ADV-H01",
    turns: [
      "wepa, tengo una fuga en el baño en betania",
      "soy juan mora, 62220101",
      "mañana en la tarde me sirve",
      "mejor el martes a las 4",
      "¿a qué hora quedó?",
    ],
  },
  {
    id: "ADV-H02",
    turns: [
      "hola necesito mantenimiento de 2 aires en edison park ph el mare 3a",
      "irving corro 65656565",
      "¿trabajan domingo?",
      "bueno mañana después del almuerzo",
      "perdón es edison no san francisco",
    ],
  },
  {
    id: "ADV-H03",
    turns: [
      "quiero instalar cerradura digital",
      "olvida eso, mejor pintar la sala",
      "es apartamento en costa del este",
      "soy ana belén 62220103",
    ],
  },
  {
    id: "ADV-H04",
    turns: [
      "tengo dos aires pero solo uno cae agua",
      "betania, carlos pérez 62220104",
      "no sé la marca",
      "mañana temprano",
    ],
  },
  {
    id: "ADV-H05",
    turns: [
      "necesito plomería urgente en el dorado",
      "roberto díaz 62220105",
      "¿cuánto cuesta más o menos?",
      "ok agendemos",
      "me sirve la primera opción",
    ],
  },
  {
    id: "ADV-H06",
    turns: [
      "hola",
      "fuga en cocina",
      "maría luna 62220106 betania",
      "cancélalo",
      "me refería a otra cosa, sigamos con la fuga",
    ],
  },
  {
    id: "ADV-H07",
    turns: [
      "el aire no enfría nada en verano",
      "pedro salas 62220107, vivo en arraiján",
      "tengo 3 equipos pero el del cuarto es el malo",
      "prefiero las 4",
    ],
  },
  {
    id: "ADV-H08",
    turns: [
      "necesito electricista y también revisar una fuga",
      "lo más urgente es la fuga",
      "luz gómez 62220108 san francisco",
      "mañana 10am",
    ],
  },
  {
    id: "ADV-H09",
    turns: [
      "¿pueden instalar aire split?",
      "sí en betania",
      "daniela ruiz 62220109",
      "no tengo referencia del equipo",
      "martes en la mañana",
    ],
  },
  {
    id: "ADV-H10",
    turns: [
      "buenas, una consulta",
      "tengo humedad en la pared del cuarto",
      "es en clayton, luis méndez 62220110",
      "mejor hablamos mañana a las 2",
      "¿cuál es mi número de solicitud?",
      "gracias",
    ],
  },
];

function wipeDb() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dbPath)) return;
  const db = new Database(dbPath);
  for (const t of [
    "concierge_messages",
    "concierge_events",
    "concierge_conversations",
    "revenue_appointments",
    "revenue_events",
    "revenue_leads",
    "service_requests",
    "revenue_customers",
    "outbox_events",
  ]) {
    try {
      db.exec(`DELETE FROM ${t}`);
    } catch {
      /* ok */
    }
  }
  db.close();
  try {
    unlinkSync(join(dataDir, ".concierge-test-inject"));
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
    async chat(text) {
      const res = await fetch(`${BASE}/api/concierge/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
        body: JSON.stringify({ message: text, conversationId: conversationId || undefined }),
      });
      const setCookie = res.headers.get("set-cookie") || "";
      const m = setCookie.match(/hs_cid=([^;]+)/);
      if (m) cookie = `hs_cid=${m[1]}`;
      const data = await res.json();
      if (data.conversationId) conversationId = data.conversationId;
      return { reply: data.reply || "", data, status: res.status };
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

async function runScenario(scenario) {
  const c = makeClient();
  await c.newConversation();
  const log = {
    id: scenario.id,
    conversationId: c.id,
    turns: [],
    failures: [],
  };
  for (const text of scenario.turns) {
    const { reply, data, status } = await c.chat(text);
    log.turns.push({ user: text, assistant: reply, status, leadId: data.leadId || data.requestCard?.leadId || null });
    await wait(400);
  }
  log.conversationId = c.id;
  return log;
}

async function main() {
  try {
    await fetch(BASE);
  } catch {
    console.error("Server not reachable at", BASE);
    process.exit(1);
  }

  wipeDb();
  await wait(1500);
  mkdirSync(outDir, { recursive: true });

  const campaign = [];
  for (const scenario of SCENARIOS) {
    console.log(`Running ${scenario.id}...`);
    const log = await runScenario(scenario);
    campaign.push(log);
    await wait(1200);
  }

  writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), campaign }, null, 2));

  const metrics = spawnSync("npx", ["tsx", "scripts/adversarial-campaign-metrics.ts", outFile], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  if (metrics.stdout) process.stdout.write(metrics.stdout);
  if (metrics.stderr) process.stderr.write(metrics.stderr);
  if (metrics.status !== 0) {
    console.error("CAMPAIGN METRICS FAILED");
    process.exit(1);
  }
  console.log(`\nBROWSER HUMAN ADVERSARIAL CAMPAIGN PASS (${SCENARIOS.length} conversations)`);
  console.log(`Log: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
