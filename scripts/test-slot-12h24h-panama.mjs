/**
 * Verifies 12h→24h slot resolution for America/Panama-style labels (isolated).
 */
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = process.cwd();
const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "slot-12h24h");
process.env.AI_CONCIERGE_ENABLED = "true";
process.env.AI_CONCIERGE_ENGINE = "n8n";
process.env.AI_CONCIERGE_N8N_MODE = "local";
process.env.CONCIERGE_INTERNAL_SECRET = "isolated-concierge-secret-not-for-prod";

const { startConcierge } = await import("../src/lib/concierge-engine.ts");
const { touchConversation, getConversation } = await import("../src/lib/concierge-store.ts");
const { toolRouteDecision } = await import("../src/lib/concierge/business-tools.ts");

const cid = startConcierge("127.0.0.1", { source: "slot-12h24h" });
const date = "2026-10-20";
touchConversation(cid, {
  state: {
    ...getConversation(cid).state,
    contactStatus: "VALID",
    phone: "+50762220001",
    location: "Bethania",
    primaryService: "plumbing",
    service: "plumbing",
    activeLeadId: "HS-TEST-SLOT",
    awaitingSlotSelection: true,
    offeredSlots: [
      { date, time: "00:00", label: `lunes, 20 oct, 12:00 a. m.`, slotId: `${date}T00:00` },
      { date, time: "12:00", label: `lunes, 20 oct, 12:00 p. m.`, slotId: `${date}T12:00` },
      { date, time: "14:00", label: `lunes, 20 oct, 2:00 p. m.`, slotId: `${date}T14:00` },
      { date, time: "16:00", label: `lunes, 20 oct, 4:00 p. m.`, slotId: `${date}T16:00` },
    ],
  },
});

let failed = 0;
function ok(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"} [12h24h] ${name}${detail ? ` · ${detail}` : ""}`);
  if (!cond) failed += 1;
}

const cases = [
  ["Me sirve 12:00 a. m.", "00:00"],
  ["Me sirve 12:00 p. m.", "12:00"],
  ["el de las 2:00 p. m.", "14:00"],
  ["Me sirve 4:00 p. m.", "16:00"],
  ["a las 2:00", "14:00"],
];

for (const [text, expectTime] of cases) {
  const r = toolRouteDecision(cid, text);
  const hint = r.data?.bookHint || {};
  ok(
    text,
    r.data?.nextAction === "BOOK" && hint.time === expectTime && hint.date === date,
    `next=${r.data?.nextAction} hint=${JSON.stringify(hint)}`,
  );
}

process.exit(failed ? 1 : 0);
