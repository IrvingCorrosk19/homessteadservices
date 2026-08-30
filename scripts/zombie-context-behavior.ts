/**
 * P0 Zombie context / stale photo response / session isolation.
 * Run: npx tsx scripts/zombie-context-behavior.ts
 */
import {
  applyConversationTransition,
  detectConversationTransition,
  isPendingActionStillValid,
  responseReferencesStaleService,
} from "../src/lib/concierge/service-transition";
import {
  digitalLockHumanReply,
  emptyDigitalLockChecklist,
  getDigitalLockChecklist,
  historySuggestsDigitalLockFlow,
  setDigitalLockChecklist,
  visionFailedResult,
} from "../src/lib/concierge/digital-lock-vision";
import { applyPackedExtraction, extractPackedMessage } from "../src/lib/concierge/packed-extraction";
import { resolvePrimaryFromMessage } from "../src/lib/concierge/service-intent";
import { parseNaturalDateTime } from "../src/lib/concierge-datetime";
import { mergeParsedWhen } from "../src/lib/concierge-tools";
import { parseConciergePhotoMessage } from "../src/lib/concierge-photo-message";
import {
  canEmitPhotoValidationReply,
  currentTurnPhotoIds,
  isStaleVisionResult,
  lockPhotoReplyIncompatibleWithState,
  resolveDigitalLockTurnPolicy,
} from "../src/lib/concierge/turn-context-guards";
import { telegramServiceLines } from "../src/lib/concierge/playbook-engine";
import type { ConversationState } from "../src/lib/concierge-store";

export const EXACT_AC_MESSAGE = `Hola, necesito mantenimiento de 2 aires acondicionados
mañana a las 2:00 p. m.
Estoy en Edison Park, PH El Mare, apartamento 3A.
Mi nombre es Irving Corro y mi teléfono es 65656565.`;

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
  s.name = "Carlos";
  s.phone = "+50760000000";
  s.contactStatus = "VALID";
  s.location = "Costa del Este";
  s.facts = {
    unit: "12B",
    serviceContextId: "locksmith-1",
    serviceContextVersion: "1",
    pendingAction: "ASK_LOCK_EDGE_PHOTO",
    pendingActionService: "locksmith",
    pendingActionServiceContextId: "locksmith-1",
    pendingPhotoRequirement: "1",
  };
  s.activeLeadId = "HS-2026-000199";
  const checklist = emptyDigitalLockChecklist();
  checklist.active = true;
  checklist.front = {
    photoId: "photo-front-1.jpg",
    status: "PASS",
    imageType: "front",
    quality: "good",
    confidence: 0.9,
    observations: [],
    missingVisualInformation: [],
  };
  checklist.inside = {
    photoId: "photo-inside-1.jpg",
    status: "PASS",
    imageType: "inside",
    quality: "good",
    confidence: 0.9,
    observations: [],
    missingVisualInformation: [],
  };
  checklist.edge = null;
  checklist.analyzedPhotoIds = ["photo-front-1.jpg", "photo-inside-1.jpg"];
  s = setDigitalLockChecklist(s, checklist);
  return s;
}

const historyWithUnanalyzed = [
  { role: "user", body: "Quiero instalar una cerradura digital" },
  { role: "assistant", body: "Claro, te ayudamos con la cerradura digital..." },
  { role: "user", body: "[Foto adjunta: photo-front-1.jpg]" },
  { role: "assistant", body: "Perfecto, esta me sirve como frente." },
  { role: "user", body: "[Foto adjunta: photo-inside-1.jpg]" },
  { role: "assistant", body: "Solo me falta una foto del canto." },
  { role: "user", body: "[Foto adjunta: photo-unanalyzed.jpg]" },
  { role: "user", body: EXACT_AC_MESSAGE },
];

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const before = lockState();
const detectedService = resolvePrimaryFromMessage(EXACT_AC_MESSAGE);
const transition = detectConversationTransition(before, EXACT_AC_MESSAGE);
ok("EXACT detectedService ac", detectedService === "ac");
ok("EXACT SWITCH_SERVICE", transition.kind === "SWITCH_SERVICE");
ok("EXACT next ac", transition.nextService === "ac");
ok("EXACT previous locksmith", transition.previousService === "locksmith");

let after = applyConversationTransition(before, transition, { cancelExistingHs: false });
after = applyPackedExtraction(after, EXACT_AC_MESSAGE);
after = mergeParsedWhen(after, EXACT_AC_MESSAGE);
const packed = extractPackedMessage(EXACT_AC_MESSAGE);
const when = parseNaturalDateTime(EXACT_AC_MESSAGE);

ok("EXACT name Irving Corro", packed.name === "Irving Corro");
ok("EXACT phone 65656565", (packed.phone || "").replace(/\D/g, "").endsWith("65656565"));
ok("EXACT location Edison Park", /edison park/i.test(packed.location || after.location));
ok("EXACT building El Mare", /mare/i.test(packed.building || after.facts?.building || ""));
ok("EXACT unit 3A", packed.unit === "3A" || after.facts?.unit === "3A");
ok("EXACT quantity 2", packed.units === "2" || after.facts?.units === "2");
ok("EXACT time 14:00", when.time === "14:00" || after.preferredTime === "14:00");
ok("EXACT date parsed", Boolean(when.date || after.preferredDate));
ok("EXACT lock inactive", getDigitalLockChecklist(after).active === false);
ok("EXACT abandoned", after.facts?.digitalLockAbandoned === "1");
ok("EXACT service ac", after.primaryService === "ac");
ok("EXACT old HS cleared", after.activeLeadId === "");
ok("EXACT pending lock invalid", !isPendingActionStillValid("ASK_LOCK_EDGE_PHOTO", after));

const photoIds = currentTurnPhotoIds({
  text: EXACT_AC_MESSAGE,
  history: historyWithUnanalyzed,
  skipUserMessage: false,
});
ok("ZERO_ATTACHMENT photoIds empty", photoIds.length === 0);
ok("ZERO_ATTACHMENT parse text not photo", parseConciergePhotoMessage(EXACT_AC_MESSAGE) === null);

const policy = resolveDigitalLockTurnPolicy({
  text: EXACT_AC_MESSAGE,
  history: historyWithUnanalyzed,
  skipUserMessage: false,
  state: after,
  transitionKind: transition.kind,
});
ok("ZERO_ATTACHMENT count 0", policy.attachmentCount === 0);
ok("PHOTO_VALIDATION not run", policy.runVision === false);
ok("PHOTO_VALIDATION not emitted", policy.emitPhotoReply === false);
ok("PHOTO_VALIDATION reason no image or invalidated", policy.reason !== "ok");

const zombie = digitalLockHumanReply(getDigitalLockChecklist(before), visionFailedResult("VISION_ANALYSIS_FAILED"), "unknown");
ok(
  "ZOMBIE text is the lock-photo reply",
  /esta imagen no muestra la puerta o la cerradura/i.test(zombie),
);
ok("ZOMBIE blocked on new state", responseReferencesStaleService(zombie, after));
ok("ZOMBIE incompatible with AC state", lockPhotoReplyIncompatibleWithState(zombie, after));
ok(
  "ZOMBIE cannot emit without image",
  canEmitPhotoValidationReply({
    currentTurnHasImage: false,
    activeService: after.primaryService,
    lockActive: getDigitalLockChecklist(after).active,
    abandoned: after.facts?.digitalLockAbandoned === "1",
  }) === false,
);

ok("HISTORY lock suggestion still true on old transcript", historySuggestsDigitalLockFlow(historyWithUnanalyzed.slice(0, 6)));

// Same-conversation switch without abandon phrase
{
  const t = detectConversationTransition(lockState(), "Ahora necesito mantenimiento de aire acondicionado.");
  ok("SAME_CONVERSATION_SWITCH", t.kind === "SWITCH_SERVICE" && t.nextService === "ac");
}

// Unrelated pairs without "mejor"
{
  const paint = detectConversationTransition(lockState(), "necesito pintura de la sala");
  ok("LOCK_TO_PAINT SWITCH", paint.kind === "SWITCH_SERVICE" && paint.nextService === "painting");
  const plumbing = detectConversationTransition(
    { ...empty(), primaryService: "ac", service: "ac" },
    "necesito plomería, hay una fuga",
  );
  ok("AC_TO_PLUMBING SWITCH", plumbing.kind === "SWITCH_SERVICE" && plumbing.nextService === "plumbing");
  const nextTrade = detectConversationTransition(
    { ...empty(), primaryService: "painting", service: "painting" },
    "necesito mantenimiento de aire acondicionado",
  );
  ok("PAINT_TO_AC SWITCH", nextTrade.kind === "SWITCH_SERVICE" && nextTrade.nextService === "ac");
  const lockAgain = detectConversationTransition(
    { ...empty(), primaryService: "plumbing", service: "plumbing" },
    "necesito instalar una cerradura digital",
  );
  ok("PLUMBING_TO_LOCK SWITCH", lockAgain.kind === "SWITCH_SERVICE" && lockAgain.nextService === "locksmith");
}

// ADD still not a silent switch
{
  const add = detectConversationTransition(lockState(), "también necesito pintar la sala");
  ok("ADD still ADD", add.kind === "ADD_ANOTHER_SERVICE");
}

// Photo PUT still sees current-turn photos
{
  const photoHistory = [
    { role: "assistant", body: "Envíame el canto." },
    { role: "user", body: "[Foto adjunta: photo-edge.jpg]" },
  ];
  const ids = currentTurnPhotoIds({
    text: "Comparto esta foto para orientar el servicio.",
    history: photoHistory,
    skipUserMessage: true,
  });
  ok("PHOTO_PUT current turn ids", ids.length === 1 && ids[0] === "photo-edge.jpg");
  const lock = lockState();
  const photoPolicy = resolveDigitalLockTurnPolicy({
    text: "Comparto esta foto para orientar el servicio.",
    history: photoHistory,
    skipUserMessage: true,
    state: lock,
    transitionKind: "CONTINUE_CURRENT_SERVICE",
  });
  ok("PHOTO_PUT vision allowed on lock context", photoPolicy.runVision === true);
}

// Late vision result after switch
{
  const stale = isStaleVisionResult(
    {
      conversationId: "conv-a",
      photoId: "photo-unanalyzed.jpg",
      serviceContextId: "locksmith-1",
      stateVersion: "1",
    },
    {
      conversationId: "conv-a",
      serviceContextId: after.facts?.serviceContextId || "ac-2",
      digitalLockAbandoned: true,
      primaryService: "ac",
      lockActive: false,
    },
  );
  ok("LATE_VISION discarded", stale === true);
  const otherConv = isStaleVisionResult(
    {
      conversationId: "conv-a",
      photoId: "p1",
      serviceContextId: "locksmith-1",
      stateVersion: "1",
    },
    {
      conversationId: "conv-b",
      serviceContextId: "locksmith-1",
      primaryService: "locksmith",
      lockActive: true,
    },
  );
  ok("CROSS_CONVERSATION vision discarded", otherConv === true);
}

// New conversation isolation: empty state has no lock requirements
{
  const fresh = empty();
  const isolated = resolveDigitalLockTurnPolicy({
    text: "Necesito mantenimiento de aire acondicionado.",
    history: [],
    skipUserMessage: false,
    state: fresh,
    transitionKind: "CONTINUE_CURRENT_SERVICE",
  });
  ok("NEW_CONVERSATION no vision", isolated.runVision === false);
  ok("NEW_CONVERSATION no lock active", getDigitalLockChecklist(fresh).active === false);
  ok("NEW_CONVERSATION no pending lock", isPendingActionStillValid("ASK_LOCK_EDGE_PHOTO", fresh) === false);
}

{
  const lines = telegramServiceLines({
    service: after.primaryService,
    message: EXACT_AC_MESSAGE,
    photoCount: 0,
    factsJson: JSON.stringify({ facts: after.facts || {} }),
  }).join("\n");
  ok("TELEGRAM no lock block after AC switch", !/CERRADURA DIGITAL|pestillo|canto/i.test(lines));
  ok("TELEGRAM uses AC service", /aire/i.test(lines));
}

console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASS");
process.exit(failed ? 1 : 0);
