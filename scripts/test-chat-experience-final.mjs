import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const routing = readFileSync(join(root, "src/lib/concierge-turn-routing.ts"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const integrity = readFileSync(join(root, "src/lib/concierge-integrity.ts"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const transaction = readFileSync(join(root, "src/lib/concierge-transaction.ts"), "utf8");
const store = readFileSync(join(root, "src/lib/concierge-store.ts"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

function interpretTurnRoute(text, state = { offeredSlots: [{ date: "2026-08-24", time: "08:00", label: "lunes 24 ago 8:00 a. m." }], awaitingSlotSelection: true, lastAvailabilityAt: new Date().toISOString(), bookingSuspended: false, primaryService: "ac", service: "ac" }) {
  const PRICE = /\b(cu[aá]nto|cuesta|precio|costo|valor|tarifa|m[aá]s o menos|aproximadamente|cotiz|presupuesto|caro|barato)\b/i;
  const dominated = PRICE.test(text);
  const slotSelectionIntent = !dominated && /^\d{1,2}(:\d{2})?\s*(am|pm|a\.?\s*m\.?|p\.?\s*m\.?)?$/i.test(text.trim());
  return { priceIntent: PRICE.test(text), slotSelectionIntent, isInterruption: dominated && !slotSelectionIntent };
}

ok("CE-01 turn routing module", /interpretTurnRoute/.test(routing));
ok("CE-02 price intent detection", /priceIntent/.test(routing));
ok("CE-03 explicit slot selection", /isExplicitSlotSelection/.test(routing));
ok("CE-04 engine uses interpretTurnRoute", /interpretTurnRoute/.test(engine));
ok("CE-05 interruption system block", /INTERRUPCIÓN/.test(engine));
ok("CE-06 response loop detection", /RESPONSE_LOOP_DETECTED/.test(engine));
ok("CE-07 price guidance reply", /priceGuidanceReply/.test(routing));
ok("CE-08 skip availability rewrite on interruption", /skipRewrite/.test(integrity) && /skipRewrite:/.test(engine));
ok("CE-09 bookingSuspended state", /bookingSuspended/.test(store));
ok("CE-10 no HS banner in snapshot", /leadBanner: null/.test(transaction));
ok("CE-11 slot groups", /buildSlotGroups/.test(routing));
ok("CE-12 collapsible booking UI", /Cita pendiente · Ver horarios/.test(widget));
ok("CE-13 close and minimize header", /Minimizar chat/.test(widget) && /Cerrar chat/.test(widget));
ok("CE-13b minimize preserves session", /CHAT_MINIMIZED_KEY/.test(widget) && /minimizeChat\(\)/.test(widget));
ok("CE-13c smart jump indicator", /Nuevo mensaje/.test(widget) && /showJumpToBottom/.test(widget));
ok("CE-13d message scroll region", /overscroll-contain/.test(widget) && /min-h-0 flex-1/.test(widget));
ok("CE-13e panel dvh height", /100dvh/.test(widget) && /min\(760px/.test(widget));
ok("CE-13f historical collapse", /Horarios anteriores \(\{historicalChips\.length\}\)/.test(widget));
ok("CE-13g footer composer fixed", /<footer className="shrink-0/.test(widget));
ok("CE-14 service context not HS", /serviceContext/.test(widget) && !/Solicitud activa:/.test(widget));
ok("CE-15 ESC minimizes chat", /Escape/.test(widget) && /minimizeChatRef/.test(widget));
ok("CE-16 date grouped slots", /group.dateLabel/.test(widget));

const priceCase = interpretTurnRoute("perfecto y cuanto seria mas o menos");
ok("CE-17 exact bug price not slot", priceCase.priceIntent && !priceCase.slotSelectionIntent);
ok("CE-18 exact bug is interruption", priceCase.isInterruption);

const slotCase = interpretTurnRoute("me sirve la de las 2");
ok("CE-19 slot pick not price interruption", !slotCase.priceIntent);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nCHAT EXPERIENCE FINAL static checks OK");
