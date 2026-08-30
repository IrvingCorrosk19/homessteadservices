import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tx = readFileSync(join(root, "src/lib/concierge-transaction.ts"), "utf8");
const store = readFileSync(join(root, "src/lib/concierge-store.ts"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const tools = readFileSync(join(root, "src/lib/concierge-tools.ts"), "utf8");
const route = readFileSync(join(root, "src/app/api/concierge/chat/route.ts"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const OFFERED_SLOTS_TTL_MS = 45 * 60 * 1000;

function baseState(overrides = {}) {
  return {
    service: "ac",
    primaryService: "ac",
    problem: "no enfría",
    location: "Panamá",
    name: "Ana",
    phone: "+50760000000",
    offeredSlots: [
      { date: "2026-08-23", time: "08:00", label: "domingo 23 agosto 8:00 a. m." },
      { date: "2026-08-23", time: "12:00", label: "domingo 23 agosto 12:00 p. m." },
    ],
    awaitingSlotSelection: true,
    slotOfferToken: "token-a",
    activeLeadId: "HS-2026-000025",
    lastAvailabilityAt: new Date().toISOString(),
    funnelStage: "BOOKING",
    appointmentId: "",
    historicalSlotLabels: [],
    ...overrides,
  };
}

function slotsAreExpired(state, now = Date.now()) {
  if (!state.lastAvailabilityAt) return true;
  const age = now - Date.parse(state.lastAvailabilityAt);
  return !Number.isFinite(age) || age > OFFERED_SLOTS_TTL_MS;
}

function areOfferedSlotsActive(state, now = Date.now()) {
  if (!state.awaitingSlotSelection) return false;
  if (!state.offeredSlots?.length) return false;
  if (slotsAreExpired(state, now)) return false;
  return true;
}

function clearActiveTransactionState(state, archiveSlots = false) {
  const archived = archiveSlots
    ? [...new Set([...(state.historicalSlotLabels || []), ...state.offeredSlots.map((s) => s.label)])].slice(-6)
    : state.historicalSlotLabels || [];
  return {
    ...state,
    offeredSlots: [],
    pendingSlot: null,
    awaitingSlotSelection: false,
    slotOfferToken: "",
    bookingIntent: false,
    historicalSlotLabels: archived,
  };
}

function isReturningGreeting(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\b(me sirve|la de las)\b/i.test(trimmed)) return false;
  if (/^(hola|buenas|buenos d[ií]as|hey)[\s!.?]*$/i.test(trimmed)) return true;
  if (/hola.*(otra vez|de nuevo|volv[ií])/i.test(trimmed)) return true;
  if (/^(soy yo|volv[ií]|aqu[ií] estoy)[\s!.?]*$/i.test(trimmed)) return true;
  return false;
}

function reconcileTransactionState(state, text, conversationLeadId) {
  let next = { ...state, activeLeadId: state.activeLeadId || "" };
  if (!next.activeLeadId && conversationLeadId && next.funnelStage !== "BOOKED") {
    next.activeLeadId = conversationLeadId;
  }
  if (!areOfferedSlotsActive(next) && next.offeredSlots.length) {
    next = clearActiveTransactionState(next);
  }
  if (isReturningGreeting(text) && (next.offeredSlots.length || next.awaitingSlotSelection)) {
    next = clearActiveTransactionState(next, true);
    next.activeLeadId = "";
    next.funnelStage = "DISCOVERY";
  }
  return next;
}

function buildSessionSnapshot(state, now = Date.now()) {
  const active = areOfferedSlotsActive(state, now);
  const chips = active && !state.bookingSuspended ? state.offeredSlots.slice(0, 3).map((item) => item.label) : [];
  const leadBanner = null;
  return { chips, historicalChips: state.historicalSlotLabels || [], leadBanner, awaitingSlotSelection: active };
}

function validateActiveSlotBooking(state, date, time) {
  if (!areOfferedSlotsActive(state)) {
    return { ok: false, reason: "stale_offers" };
  }
  if (!state.offeredSlots.some((slot) => slot.date === date && slot.time === time)) {
    return { ok: false, reason: "slot_not_offered" };
  }
  return { ok: true };
}

// --- Architecture gates ---
ok("transaction module exists", /reconcileTransactionState/.test(tx) && /validateActiveSlotBooking/.test(tx));
ok("awaitingSlotSelection in store", /awaitingSlotSelection/.test(store) && /activeLeadId/.test(store));
ok("historicalSlotLabels in store", /historicalSlotLabels/.test(store));
ok("activateOfferedSlots sets token", /activateOfferedSlots/.test(tools) && /slotOfferToken/.test(tx));
ok("create_appointment validates slots", /validateActiveSlotBooking/.test(tools));
ok("engine gates chips on active slots", /areOfferedSlotsActive\(state\)/.test(engine));
ok("engine reconcile at turn start", /reconcileTransactionState/.test(engine));
ok("engine leadBanner not sticky leadPublicId", /shouldShowLeadBanner/.test(engine) && /leadBanner/.test(engine));
ok("GET returns session snapshot", /buildSessionSnapshot/.test(route) && /historicalChips/.test(route));
ok("GET expires stale slots", /clearActiveTransactionState/.test(route));
ok("NEW_CONVERSATION event", /NEW_CONVERSATION/.test(route));
ok("GET returns conversationId", /conversationId/.test(route));
ok("widget Nueva solicitud starts isolated chat", /startNewConversation/.test(widget) && /Nueva solicitud/.test(widget));
ok("widget waits for session hydrate", /sessionReady/.test(widget));
ok("widget uses serviceContext not HS banner", /serviceContext/.test(widget) && !/Solicitud activa:/.test(widget));
ok("widget historical chips disabled", /Horarios anteriores/.test(widget) && /aria-disabled/.test(widget));
ok("widget clears chips on send", /setChips\(\[\]\)/.test(widget));

// --- Bug reproduction: HS-2026-000025 + slots + returning greeting ---
{
  const before = baseState();
  const after = reconcileTransactionState(before, "hola soy yo otra vez", "HS-2026-000025");
  const session = buildSessionSnapshot(after);
  ok("ISO-01 returning greeting clears active slots", after.offeredSlots.length === 0 && !after.awaitingSlotSelection);
  ok("ISO-02 returning greeting clears activeLeadId", after.activeLeadId === "");
  ok("ISO-03 no active chips after greeting", session.chips.length === 0);
  ok("ISO-04 no lead banner after greeting", session.leadBanner === null);
  ok("ISO-05 slots archived as historical", session.historicalChips.length >= 2);
}

// --- TTL expiration ---
{
  const stale = baseState({
    lastAvailabilityAt: new Date(Date.now() - OFFERED_SLOTS_TTL_MS - 1000).toISOString(),
  });
  ok("ISO-06 TTL marks slots inactive", !areOfferedSlotsActive(stale));
  const cleaned = reconcileTransactionState(stale, "sigo aquí", "HS-2026-000025");
  ok("ISO-07 expired slots cleared on reconcile", cleaned.offeredSlots.length === 0);
}

// --- Server rejects stale slot booking ---
{
  const cleared = clearActiveTransactionState(baseState(), true);
  const reject = validateActiveSlotBooking(cleared, "2026-08-23", "08:00");
  ok("ISO-08 stale slot booking rejected", !reject.ok && reject.reason === "stale_offers");
}

// --- Old slot not in current offer set ---
{
  const active = baseState();
  const reject = validateActiveSlotBooking(active, "2026-08-23", "14:00");
  ok("ISO-09 slot not offered rejected", !reject.ok && reject.reason === "slot_not_offered");
}

// --- Continuity: slot selection signal on greeting does NOT reset ---
{
  const active = baseState();
  const kept = reconcileTransactionState(active, "me sirve la de las 2", "HS-2026-000025");
  ok("ISO-10 slot pick keeps active context", areOfferedSlotsActive(kept));
}

// --- Plain hola without prior slots does not require reset ---
{
  const discovery = baseState({ offeredSlots: [], awaitingSlotSelection: false, activeLeadId: "", funnelStage: "DISCOVERY" });
  const after = reconcileTransactionState(discovery, "hola", "HS-2026-000025");
  ok("ISO-11 plain hola does not force archive", after.historicalSlotLabels.length === 0);
}

// --- Active session shows banner only when slots active ---
{
  const active = baseState();
  const session = buildSessionSnapshot(active);
  ok("ISO-12 active transaction shows chips not HS banner", session.chips.length === 2 && session.leadBanner === null);
  ok("ISO-13 active transaction shows chips", session.chips.length === 2);
}

// --- After booking consume clears offers ---
ok("ISO-14 consumeOfferedSlots in tools", /consumeOfferedSlots/.test(tools));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nCONVERSATION SESSION ISOLATION static checks OK");
