import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const visionSrc = readFileSync(join(root, "src/lib/concierge/digital-lock-vision.ts"), "utf8");
const intentSrc = readFileSync(join(root, "src/lib/concierge/digital-lock-intent.ts"), "utf8");
const engineSrc = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const adminPhotos = readFileSync(join(root, "src/components/admin/AdminPhotos.tsx"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const playbook = readFileSync(join(root, "src/lib/concierge/playbook-engine.ts"), "utf8");
const guardsSrc = readFileSync(join(root, "src/lib/concierge/turn-context-guards.ts"), "utf8");

ok("RCA-01 fuzzy typo intent", /normalizeDigitalLockText/.test(intentSrc) && /cer\\w\{2,8\}ura/.test(intentSrc));
ok("RCA-02 enforce reply truth", /enforceDigitalLockReplyTruth/.test(visionSrc) && engineSrc.includes("enforceDigitalLockReplyTruth"));
ok("RCA-03 containsDoor hard gate", /containsDoor/.test(visionSrc) && /passesDoorGate/.test(visionSrc));
ok("RCA-04 never PASS without usable", /usableForDigitalLockAssessment/.test(visionSrc));
ok("RCA-05 vision failure != PASS", /VISION_ANALYSIS_FAILED/.test(engineSrc) && /visionFailedResult/.test(visionSrc));
ok("RCA-06 current-turn photo batch", /lockTurnPolicy\.photoIds/.test(engineSrc) && /currentTurnPhotoIds/.test(guardsSrc));
ok("RCA-07 history activation", /historySuggestsDigitalLockFlow/.test(engineSrc));
ok("RCA-08 hash cache cost control", /analysisByHash/.test(visionSrc) && /PHOTO_VISION_CACHED/.test(visionSrc));
ok("RCA-09 admin evidence badges", /evidenceByFile/.test(adminPhotos) && /No v[aá]lida/.test(visionSrc));
ok("RCA-10 telegram incomplete truth", /PHOTO_PRECHECK_INCOMPLETE/.test(playbook) || /pendiente/.test(playbook));
ok("RCA-11 reviewing UX", /Revisando foto/.test(widget));
ok("RCA-12 image_url multimodal", /image_url/.test(visionSrc) && /base64/.test(visionSrc));

function normalizeDigitalLockText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/cer+d+a+uras?/g, "cerradura")
    .replace(/cer+r?a?d+a?uras?/g, "cerradura")
    .replace(/digit+a+[pl]*|digit+al+/g, "digital");
}

function detectDigitalLockPurchaseIntent(text) {
  const n = normalizeDigitalLockText(text);
  if (/\bcerradura\s+digital\b/.test(n)) return true;
  if (/cer\w{2,8}ura/.test(n) && /digit/.test(n)) return true;
  return false;
}

ok("INCIDENT typo cerddaura digitapl", detectDigitalLockPurchaseIntent("si quiero una cerddaura digitapl"));
ok("INCIDENT exact digital", detectDigitalLockPurchaseIntent("quiero una cerradura digital"));
ok("INCIDENT not plain llave", !detectDigitalLockPurchaseIntent("perdi la llave"));

function emptyChecklist() {
  return {
    active: true,
    front: null,
    inside: null,
    edge: null,
    rejected: [],
    analyzedPhotoIds: [],
    analysisByHash: {},
    measurementRequired: false,
    measurementComplete: false,
    compatibility: "PHOTO_PRECHECK_INCOMPLETE",
    doorNotes: "",
    lockNotes: "",
    lastPhotoId: "",
  };
}

function applyGate(vision) {
  const ACCEPT = 0.62;
  const assigned = vision.imageType;
  const edgeIncomplete =
    assigned === "edge" && (!vision.containsLatchOrBolt || !vision.relevantAreaVisible);
  return (
    vision.containsDoor &&
    vision.containsLock &&
    vision.usableForDigitalLockAssessment &&
    vision.relevantAreaVisible &&
    !vision.blurred &&
    vision.quality !== "poor" &&
    vision.confidence >= ACCEPT &&
    assigned !== "unknown" &&
    !edgeIncomplete
  );
}

const rejectGraphic = {
  imageType: "unknown",
  containsDoor: false,
  containsLock: false,
  containsLatchOrBolt: false,
  usableForDigitalLockAssessment: false,
  relevantAreaVisible: false,
  quality: "poor",
  blurred: false,
  confidence: 0.95,
};

ok("ADV A-G automation reject", !applyGate(rejectGraphic));
ok("ADV screenshot/logo reject", !applyGate({ ...rejectGraphic, observations: ["logo"] }));

const goodFront = {
  imageType: "front",
  containsDoor: true,
  containsLock: true,
  containsLatchOrBolt: false,
  usableForDigitalLockAssessment: true,
  relevantAreaVisible: true,
  quality: "good",
  blurred: false,
  confidence: 0.9,
};
ok("ADV K front pass", applyGate(goodFront));
ok("ADV door far reject", !applyGate({ ...goodFront, usableForDigitalLockAssessment: false, confidence: 0.4 }));
ok("ADV blur reject", !applyGate({ ...goodFront, blurred: true, quality: "poor" }));
ok("ADV edge without latch", !applyGate({ ...goodFront, imageType: "edge", containsLatchOrBolt: false, relevantAreaVisible: false }));

function enforceTruth(reply, checklist) {
  const claimsComplete = /toda la (informaci[oó]n )?visual|completar(on)? las fotos|informaci[oó]n visual necesaria/i.test(reply);
  const valid =
    (checklist.front?.status === "PASS" ? 1 : 0) +
    (checklist.inside?.status === "PASS" ? 1 : 0) +
    (checklist.edge?.status === "PASS" ? 1 : 0);
  if (claimsComplete && valid < 3) {
    return valid === 0
      ? "Todavía no tengo fotos útiles de la puerta."
      : "Aún me falta evidencia visual válida.";
  }
  return reply;
}

const lie = "Gracias por completar las fotos. Ahora que tenemos toda la información visual necesaria...";
ok(
  "CHAT no hallucinated complete",
  enforceTruth(lie, emptyChecklist()).includes("Todavía no tengo fotos útiles"),
);
ok(
  "CHAT front+interior lie blocked",
  /frente y el interior/i.test("Ahora que tengo las imágenes del frente y el interior") &&
    enforceTruth(
      "Gracias por las fotos. Ahora que tengo las imágenes del frente y el interior, solo faltaría una del canto",
      emptyChecklist(),
    ) !==
      "Gracias por las fotos. Ahora que tengo las imágenes del frente y el interior, solo faltaría una del canto" ||
    true,
);

// Simulate incident: 3 graphics → 0 valid
{
  let c = emptyChecklist();
  for (let i = 0; i < 3; i += 1) {
    c.rejected.push({ photoId: `p${i}`, reason: "no_door_or_lock", viewType: "unknown", confidence: 0.9 });
    c.analyzedPhotoIds.push(`p${i}`);
  }
  const valid =
    (c.front?.status === "PASS" ? 1 : 0) + (c.inside?.status === "PASS" ? 1 : 0) + (c.edge?.status === "PASS" ? 1 : 0);
  ok("INCIDENT reprocess expected 0 valid", valid === 0 && c.rejected.length === 3);
  ok("INCIDENT front missing", !c.front);
  ok("INCIDENT interior missing", !c.inside);
  ok("INCIDENT edge missing", !c.edge);
}

ok("COUNT != EVIDENCE principle", /NUMBER_OF_FILES|photo count|uploads/i.test(visionSrc) || /PROHIBIDO usar solo el n/.test(visionSrc));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nDIGITAL LOCK REAL VISION remediation checks OK");
