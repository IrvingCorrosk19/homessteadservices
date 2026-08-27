/**
 * P0 Context Switch / Service Switch — behavioral regression.
 * Run: npx tsx scripts/context-switch-behavior.ts
 */
import {
  applyConversationTransition,
  detectConversationTransition,
  isPendingActionStillValid,
  responseReferencesStaleService,
  clearServiceScopedState,
} from "../src/lib/concierge/service-transition";
import {
  emptyDigitalLockChecklist,
  getDigitalLockChecklist,
  setDigitalLockChecklist,
  digitalLockHumanReply,
} from "../src/lib/concierge/digital-lock-vision";
import type { ConversationState } from "../src/lib/concierge-store";
import type { VisionInspectionResult } from "../src/lib/concierge/digital-lock-vision";

function empty(): ConversationState {
  return {
    service: "",
    problem: "",
    location: "",
    name: "",
    phone: "",
    email: "",
    propertyType: "",
    preferredTime: "",
    preferredDate: "",
    intent: "",
    funnelStage: "DISCOVERY",
    leadTemperature: "COLD",
    photoCount: 0,
    contactStatus: "UNKNOWN",
    offeredSlots: [],
    pendingSlot: null,
    appointmentId: "",
    awaitingSlotSelection: false,
    slotOfferToken: "",
    activeLeadId: "",
    historicalSlotLabels: [],
    humanRequested: false,
    lastAvailabilityAt: "",
    detectedServices: [],
    primaryService: "",
    secondaryServices: [],
    facts: {},
    urgency: "normal",
    bookingIntent: false,
    bookingStrategy: "",
    bookingSuspended: false,
    questionsAsked: 0,
    humanHandoffRequested: false,
    needsReview: false,
    factConfidence: {},
    corrections: [],
  };
}

function lockState(): ConversationState {
  let s = empty();
  s.primaryService = "locksmith";
  s.service = "locksmith";
  s.name = "Irving";
  s.phone = "+50767676767";
  s.contactStatus = "VALID";
  s.location = "Edison Park";
  s.facts = { unit: "3A", building: "PH Test" };
  s.activeLeadId = "HS-2026-000200";
  s.offeredSlots = [{ date: "2026-08-28", time: "14:00", label: "vie 14:00" }];
  s.awaitingSlotSelection = true;
  const checklist = emptyDigitalLockChecklist();
  checklist.active = true;
  checklist.front = {
    photoId: "p1",
    status: "PASS",
    confidence: 0.9,
    reasonIfRejected: "",
    sha256: "a",
  };
  checklist.inside = {
    photoId: "p2",
    status: "PASS",
    confidence: 0.9,
    reasonIfRejected: "",
    sha256: "b",
  };
  checklist.edge = null;
  checklist.analyzedPhotoIds = ["p1", "p2"];
  s = setDigitalLockChecklist(s, checklist);
  return s;
}

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

// TEST A: lock → olvidemos pintura
{
  const before = lockState();
  const msg = "olvidemos, mejor ayudame con la pintura de la sala";
  const t = detectConversationTransition(before, msg);
  ok("A kind SWITCH_SERVICE", t.kind === "SWITCH_SERVICE");
  ok("A next painting", t.nextService === "painting");
  ok("A previous locksmith", t.previousService === "locksmith");
  const after = applyConversationTransition(before, t, { cancelExistingHs: false });
  ok("A service painting", after.primaryService === "painting");
  ok("A lock inactive", getDigitalLockChecklist(after).active === false);
  ok("A abandoned flag", after.facts?.digitalLockAbandoned === "1");
  ok("A name preserved", after.name === "Irving");
  ok("A phone preserved", after.contactStatus === "VALID");
  ok("A location preserved", /edison/i.test(after.location));
  ok("A unit preserved", after.facts?.unit === "3A");
  ok("A slots cleared", (after.offeredSlots || []).length === 0);
  ok("A activeLeadId cleared", after.activeLeadId === "");
  ok("A pending lock action invalid", !isPendingActionStillValid("ASK_LOCK_EDGE_PHOTO", after));
  const staleReply =
    "Perfecto, esta me sirve como parte interior. Solo me falta una foto del canto / pestillo.";
  ok("A stale response detected", responseReferencesStaleService(staleReply, after));
}

// TEST B: AC → plumbing
{
  const s = { ...empty(), primaryService: "ac", service: "ac", activeLeadId: "HS-A" };
  const t = detectConversationTransition(s, "mejor necesito plomería");
  ok("B SWITCH", t.kind === "SWITCH_SERVICE");
  ok("B plumbing", t.nextService === "plumbing");
}

// TEST C: repairs → pintura = REFINEMENT
{
  const s = { ...empty(), primaryService: "repairs", service: "repairs", activeLeadId: "HS-R" };
  const t = detectConversationTransition(s, "Es pintura.");
  ok("C REFINE", t.kind === "REFINE_CURRENT_SERVICE");
  const after = applyConversationTransition(s, t, { cancelExistingHs: false });
  ok("C same HS", after.activeLeadId === "HS-R");
  ok("C painting", after.primaryService === "painting");
}

// TEST D: también = ADD
{
  const s = lockState();
  const t = detectConversationTransition(s, "también necesito pintar la sala");
  ok("D ADD_ANOTHER_SERVICE", t.kind === "ADD_ANOTHER_SERVICE");
  const after = applyConversationTransition(s, t, { cancelExistingHs: false });
  ok("D lock still active", getDigitalLockChecklist(after).active === true);
  ok("D HS preserved", after.activeLeadId === "HS-2026-000200");
}

// TEST E: cancel only
{
  const s = lockState();
  const t = detectConversationTransition(s, "ya no quiero eso");
  ok("E CANCEL", t.kind === "CANCEL_CURRENT_SERVICE");
  const after = applyConversationTransition(s, t, { cancelExistingHs: false });
  ok("E service cleared", !after.primaryService);
  ok("E lock inactive", getDigitalLockChecklist(after).active === false);
}

// TEST F: mejor no then later painting does not resurrect lock
{
  const s = lockState();
  const cancel = detectConversationTransition(s, "mejor no");
  let after = applyConversationTransition(s, cancel, { cancelExistingHs: false });
  ok("F1 cancelled", after.facts?.digitalLockAbandoned === "1");
  const later = detectConversationTransition(after, "quiero pintura");
  // no previous service → continue/new, not resurrect lock
  after = applyConversationTransition(after, later, { cancelExistingHs: false });
  ok("F2 lock still abandoned", after.facts?.digitalLockAbandoned === "1");
  ok("F2 lock inactive", getDigitalLockChecklist(after).active === false);
}

// TEST async: old human reply must not apply after clear
{
  const before = lockState();
  const t = detectConversationTransition(before, "olvidemos, mejor ayudame con la pintura de la sala");
  const after = applyConversationTransition(before, t, { cancelExistingHs: false });
  const vision: VisionInspectionResult = {
    imageType: "inside",
    containsDoor: true,
    containsLock: true,
    containsLatchOrBolt: false,
    usableForDigitalLockAssessment: true,
    relevantAreaVisible: true,
    blurred: false,
    tooDark: false,
    tooClose: false,
    tooFar: false,
    criticalAreaCropped: false,
    duplicateSuspected: false,
    quality: "good",
    confidence: 0.9,
    missingVisualInformation: [],
    notes: "",
  };
  const zombie = digitalLockHumanReply(getDigitalLockChecklist(before), vision, "inside");
  ok("ASYNC zombie would ask edge", /canto|pestillo/i.test(zombie));
  ok("ASYNC zombie blocked on new state", responseReferencesStaleService(zombie, after));
}

// TEST service data reset
{
  const before = lockState();
  before.facts = { ...before.facts, units: "2", symptom: "no enfría" };
  const cleared = clearServiceScopedState(before);
  ok("RESET no units", !cleared.facts?.units);
  ok("RESET no symptom", !cleared.facts?.symptom);
  ok("RESET name kept", cleared.name === "Irving");
}

console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASS");
process.exit(failed ? 1 : 0);
