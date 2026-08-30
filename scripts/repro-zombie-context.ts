/**
 * P0 REPRO — zombie lock-photo reply on packed AC request.
 * Run BEFORE code changes: npx tsx scripts/repro-zombie-context.ts
 */
import {
  applyConversationTransition,
  detectConversationTransition,
} from "../src/lib/concierge/service-transition";
import {
  activateDigitalLockFlow,
  digitalLockHumanReply,
  emptyDigitalLockChecklist,
  getDigitalLockChecklist,
  historySuggestsDigitalLockFlow,
  setDigitalLockChecklist,
  visionFailedResult,
} from "../src/lib/concierge/digital-lock-vision";
import { applyPackedExtraction, extractPackedMessage } from "../src/lib/concierge/packed-extraction";
import { resolvePrimaryFromMessage } from "../src/lib/concierge/service-intent";
import { parseConciergePhotoMessage } from "../src/lib/concierge-photo-message";
import type { ConversationState } from "../src/lib/concierge-store";

const AC_MESSAGE = `Hola, necesito mantenimiento de 2 aires acondicionados
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

function lockStateWithPendingPhoto(): ConversationState {
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
    sha256: "aaa",
  };
  checklist.inside = {
    photoId: "photo-inside-1.jpg",
    status: "PASS",
    imageType: "inside",
    quality: "good",
    confidence: 0.9,
    observations: [],
    missingVisualInformation: [],
    sha256: "bbb",
  };
  checklist.edge = null;
  checklist.analyzedPhotoIds = ["photo-front-1.jpg", "photo-inside-1.jpg"];
  s = setDigitalLockChecklist(s, checklist);
  return s;
}

function collectPendingPhotoIdsFromHistory(
  history: Array<{ role: string; body: string }>,
  checklist: ReturnType<typeof getDigitalLockChecklist>,
) {
  const pendingPhotoIds: string[] = [];
  for (const item of history) {
    if (item.role !== "user") continue;
    const parsed = parseConciergePhotoMessage(item.body);
    if (!parsed) continue;
    if (checklist.analyzedPhotoIds.includes(parsed.photoId)) continue;
    pendingPhotoIds.push(parsed.photoId);
  }
  return pendingPhotoIds;
}

const before = lockStateWithPendingPhoto();
const history = [
  { role: "user", body: "Quiero instalar una cerradura digital" },
  { role: "assistant", body: "Claro, te ayudamos con la cerradura digital..." },
  { role: "user", body: "[Foto adjunta: photo-front-1.jpg]" },
  { role: "assistant", body: "Perfecto, esta me sirve como frente." },
  { role: "user", body: "[Foto adjunta: photo-inside-1.jpg]" },
  { role: "assistant", body: "Solo me falta una foto del canto." },
  { role: "user", body: "[Foto adjunta: photo-unanalyzed.jpg]" },
];

console.log("========== BEFORE (lock pending) ==========");
console.log({
  activeService: before.primaryService,
  serviceContextId: before.facts?.serviceContextId,
  activeRequestId: before.activeLeadId,
  pendingPhotoRequirement: "ASK_LOCK_EDGE_PHOTO",
  lockActive: getDigitalLockChecklist(before).active,
  analyzedPhotoIds: getDigitalLockChecklist(before).analyzedPhotoIds,
});

const detectedIntent = resolvePrimaryFromMessage(AC_MESSAGE);
const transition = detectConversationTransition(before, AC_MESSAGE);
const packed = extractPackedMessage(AC_MESSAGE);
let extracted = applyPackedExtraction(before, AC_MESSAGE);
const historyDigital = historySuggestsDigitalLockFlow(history);
const pendingFromHistory = collectPendingPhotoIdsFromHistory(
  history,
  getDigitalLockChecklist(before),
);

console.log("\n========== CURRENT MESSAGE ==========");
console.log({
  attachmentCount: parseConciergePhotoMessage(AC_MESSAGE) ? 1 : 0,
  detectedIntent,
  transitionKind: transition.kind,
  previousService: transition.previousService,
  nextService: transition.nextService,
});

console.log("\n========== PACKED EXTRACTION ==========");
console.log({
  name: packed.name,
  phone: packed.phone,
  location: packed.location,
  building: packed.building,
  unit: packed.unit,
  units: packed.units,
  extractedService: extracted.primaryService,
});

const visionFail = visionFailedResult("VISION_ANALYSIS_FAILED");
const zombieReply = digitalLockHumanReply(getDigitalLockChecklist(before), visionFail, "unknown");

console.log("\n========== ENGINE PATH SIMULATION (current code) ==========");
console.log({
  historySuggestsDigitalLock: historyDigital,
  pendingUnanalyzedPhotos: pendingFromHistory,
  wouldActivateLockFromHistory:
    historyDigital && transition.kind !== "SWITCH_SERVICE",
  wouldRunVisionOnTextTurn: pendingFromHistory.length > 0 && transition.kind !== "SWITCH_SERVICE",
  zombieReplyIfVisionFails: zombieReply,
});

if (historyDigital && transition.kind !== "SWITCH_SERVICE") {
  extracted = activateDigitalLockFlow(extracted);
}

console.log("\n========== AFTER (if current engine continues lock) ==========");
console.log({
  activeService: extracted.primaryService,
  lockActive: getDigitalLockChecklist(extracted).active,
  overwrittenBackToLocksmith: extracted.primaryService === "locksmith",
});

const applied = applyConversationTransition(before, transition, { cancelExistingHs: false });
console.log("\n========== APPLY TRANSITION AS DETECTED ==========");
console.log({
  kind: transition.kind,
  serviceAfterApply: applied.primaryService,
  lockActiveAfterApply: getDigitalLockChecklist(applied).active,
  preferredDateWiped: applied.preferredDate === "",
});

const BUG_NO_SWITCH = transition.kind !== "SWITCH_SERVICE";
const BUG_VISION_ON_TEXT = pendingFromHistory.length > 0 && transition.kind !== "SWITCH_SERVICE";
const BUG_ZOMBIE_TEXT = /esta imagen no muestra la puerta o la cerradura/i.test(zombieReply);

console.log("\n========== REPRO VERDICT ==========");
console.log({
  ORIGINAL_BUG_STILL_PRESENT: BUG_NO_SWITCH && BUG_VISION_ON_TEXT && BUG_ZOMBIE_TEXT,
  OLD_SERVICE: "locksmith / DIGITAL_LOCK",
  NEW_SERVICE_DETECTED: detectedIntent,
  TRANSITION_KIND: transition.kind,
  ATTACHMENT_COUNT: 0,
  PHOTO_VALIDATION_WOULD_RUN: BUG_VISION_ON_TEXT,
  ZOMBIE_REPLY_TEMPLATE_EXISTS: BUG_ZOMBIE_TEXT,
});

if (BUG_NO_SWITCH && BUG_VISION_ON_TEXT) {
  console.log("\nSTILL BROKEN: text-only AC message can emit lock-photo validation reply.");
  process.exit(1);
}

console.log("\nFIXED: explicit AC request switches off lock context; vision does not run on text-only turn.");
process.exit(0);
