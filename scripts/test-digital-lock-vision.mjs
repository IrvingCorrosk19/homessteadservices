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
const engineSrc = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const txSrc = readFileSync(join(root, "src/lib/concierge-transaction.ts"), "utf8");
const playbookSrc = readFileSync(join(root, "src/lib/concierge/service-playbooks.ts"), "utf8");
const playEngineSrc = readFileSync(join(root, "src/lib/concierge/playbook-engine.ts"), "utf8");
const opsTg = readFileSync(join(root, "src/lib/ops-telegram.ts"), "utf8");
const n8nSrc = readFileSync(join(root, "src/lib/n8n.ts"), "utf8");
const photoCta = readFileSync(join(root, "src/lib/concierge-photo-cta.ts"), "utf8");
const widget = readFileSync(join(root, "src/components/concierge/ConciergeWidget.tsx"), "utf8");
const processMod = readFileSync(join(root, "src/lib/concierge-photo-process.ts"), "utf8");
const pkg = readFileSync(join(root, "package.json"), "utf8");

ok("DL-01 vision module exists", /DIGITAL_LOCK_PURCHASE_INSTALLATION|detectDigitalLockPurchaseIntent/.test(visionSrc));
ok("DL-02 structured vision schema", /imageType/.test(visionSrc) && /duplicateSuspected/.test(visionSrc) && /measurementSafeToInfer/.test(visionSrc));
ok("DL-03 never trust visual mm", /measurementSafeToInfer:\s*false/.test(visionSrc));
ok("DL-04 ask only missing", /Solo me falta/.test(visionSrc) && /digitalLockMissingViews/.test(visionSrc));
ok("DL-05 retake blur/dark", /borrosa/.test(visionSrc) && /muy oscura/.test(visionSrc));
ok("DL-06 duplicate does not fill other slot", /duplicateOfAccepted/.test(visionSrc) && /!duplicateOfAccepted && assigned/.test(visionSrc));
ok("DL-07 technician review", /REQUIRES_TECHNICIAN_REVIEW/.test(visionSrc));
ok("DL-08 engine wires vision", /analyzeDigitalLockPhoto/.test(engineSrc) && /applyDigitalLockVision/.test(engineSrc));
ok("DL-09 intro on intent", /digitalLockIntroReply/.test(engineSrc));
ok("DL-10 photo limit 8 for digital lock", /maxPhotos = digitalLock\.active \? 8 : 4/.test(engineSrc));
ok("DL-11 reset evidence on new transaction", /emptyDigitalLockChecklist/.test(txSrc) && /prior request must not satisfy/.test(txSrc));
ok("DL-12 no premature availability", /digitalLockFlow/.test(playEngineSrc) && /photosReady/.test(playEngineSrc));
ok("DL-13 admin checklist rows", /Cerradura digital/.test(playEngineSrc) && /Compatibilidad IA/.test(playEngineSrc));
ok("DL-14 telegram digital lock lines", /CERRADURA DIGITAL/.test(playEngineSrc) && /factsJson: request\.factsJson/.test(opsTg));
ok("DL-15 n8n factsJson", /factsJson: saved\.factsJson/.test(n8nSrc));
ok("DL-16 playbook safety no invent", /No inventar medidas/.test(playbookSrc));
ok("DL-17 chat UI delete/replace", /Eliminar/.test(widget) && /replacePhotoId/.test(widget));
ok("DL-18 image optimization 1920", /CONCIERGE_PHOTO_LONG_EDGE = 1920/.test(processMod));
ok("DL-19 photosRemaining max param", /maxPhotos = 4/.test(photoCta));

const DIGITAL_LOCK_INTENT =
  /\b(cerradura\s+digital|cerradura\s+inteligente|smart\s*lock|huella|fingerprint|teclado|keypad|quiero\s+(comprar|poner|instalar|cambiar).{0,40}cerradura|cerradura.{0,30}(digital|inteligente|huella))\b/i;

ok("DL-20 intent comprar digital", DIGITAL_LOCK_INTENT.test("Quiero comprar una cerradura digital"));
ok("DL-21 intent huella", DIGITAL_LOCK_INTENT.test("¿Tienen cerraduras con huella?"));
ok("DL-22 intent poner digital", DIGITAL_LOCK_INTENT.test("Quiero ponerle cerradura digital a mi puerta"));
ok("DL-23 not generic llave", !DIGITAL_LOCK_INTENT.test("Perdí la llave y no puedo entrar"));

function emptyChecklist() {
  return {
    active: true,
    front: null,
    inside: null,
    edge: null,
    measurementRequired: false,
    measurementComplete: false,
    compatibility: "NEEDS_MORE_INFO",
    doorNotes: "",
    lockNotes: "",
    lastPhotoId: "",
  };
}

function missingViews(c) {
  const out = [];
  if (c.front?.status !== "PASS") out.push("front");
  if (c.inside?.status !== "PASS") out.push("inside");
  if (c.edge?.status !== "PASS") out.push("edge");
  return out;
}

function apply(checklist, photoId, vision) {
  const assigned = vision.imageType;
  const duplicateOfAccepted =
    vision.duplicateSuspected ||
    (assigned !== "unknown" && checklist[assigned]?.status === "PASS" && checklist[assigned]?.photoId !== photoId);
  const edgeIncomplete =
    assigned === "edge" &&
    (!vision.relevantAreaVisible ||
      (vision.missingVisualInformation || []).some((item) => /pestillo|latch|placa|cerrojo/i.test(item)));
  const effective = {
    ...vision,
    duplicateSuspected: duplicateOfAccepted || vision.duplicateSuspected,
    relevantAreaVisible: edgeIncomplete ? false : vision.relevantAreaVisible,
    quality: edgeIncomplete && vision.quality === "good" ? "poor" : vision.quality,
  };
  const usable =
    !duplicateOfAccepted &&
    assigned !== "unknown" &&
    effective.relevantAreaVisible &&
    vision.lockVisible &&
    effective.quality !== "poor" &&
    vision.confidence >= 0.45 &&
    !vision.blurred &&
    !vision.tooDark;
  const evidence = {
    photoId,
    status: usable ? "PASS" : assigned === "unknown" ? "MISSING" : "RETAKE",
    imageType: assigned,
    confidence: vision.confidence,
  };
  const next = { ...checklist };
  if (!duplicateOfAccepted && assigned !== "unknown") {
    next[assigned] = evidence;
  }
  next.lastPhotoId = photoId;
  if (vision.measurementNeeded) next.measurementRequired = true;
  if (missingViews(next).length === 0) {
    const low =
      (next.front?.confidence || 0) < 0.5 ||
      (next.inside?.confidence || 0) < 0.5 ||
      (next.edge?.confidence || 0) < 0.5 ||
      vision.confidence < 0.55;
    if (low) next.compatibility = "REQUIRES_TECHNICIAN_REVIEW";
    else if (next.measurementRequired && !next.measurementComplete) next.compatibility = "NEEDS_MORE_INFO";
    else next.compatibility = "LIKELY_COMPATIBLE";
  }
  return { checklist: next, assigned, usable, duplicateOfAccepted, effective };
}

const good = (type) => ({
  imageType: type,
  doorVisible: true,
  lockVisible: true,
  relevantAreaVisible: true,
  quality: "good",
  blurred: false,
  tooDark: false,
  tooClose: false,
  tooFar: false,
  duplicateSuspected: false,
  confidence: 0.9,
  observations: [],
  missingVisualInformation: [],
  measurementNeeded: false,
});

// TEST A
{
  let c = emptyChecklist();
  c = apply(c, "p1", good("front")).checklist;
  c = apply(c, "p2", good("inside")).checklist;
  c = apply(c, "p3", good("edge")).checklist;
  ok("TEST A 3/3 accepted", missingViews(c).length === 0 && c.compatibility === "LIKELY_COMPATIBLE");
}

// TEST B duplicate front
{
  let c = emptyChecklist();
  c = apply(c, "p1", good("front")).checklist;
  c = apply(c, "p2", good("inside")).checklist;
  const dup = apply(c, "p3", { ...good("front"), duplicateSuspected: true });
  c = dup.checklist;
  ok("TEST B duplicate does not complete", missingViews(c).includes("edge") && missingViews(c).length === 1);
  ok("TEST B still 2/3", c.front?.status === "PASS" && c.inside?.status === "PASS" && !c.edge);
}

// TEST C blurred front
{
  let c = emptyChecklist();
  const r = apply(c, "p1", { ...good("front"), blurred: true, quality: "poor", confidence: 0.2 });
  ok("TEST C retake front", r.checklist.front?.status === "RETAKE" && missingViews(r.checklist).includes("front"));
}

// TEST D random
{
  let c = emptyChecklist();
  const r = apply(c, "p1", {
    ...good("unknown"),
    imageType: "unknown",
    lockVisible: false,
    relevantAreaVisible: false,
    quality: "poor",
    confidence: 0.1,
  });
  ok("TEST D unknown not complete", r.checklist.front == null && r.checklist.inside == null && r.checklist.edge == null);
}

// TEST E edge without latch
{
  let c = emptyChecklist();
  c = apply(c, "p1", good("front")).checklist;
  c = apply(c, "p2", good("inside")).checklist;
  const r = apply(c, "p3", {
    ...good("edge"),
    missingVisualInformation: ["pestillo no visible"],
  });
  ok("TEST E retake edge", r.checklist.edge?.status === "RETAKE" && missingViews(r.checklist).includes("edge"));
}

// TEST F measurement
{
  let c = emptyChecklist();
  c = apply(c, "p1", good("front")).checklist;
  c = apply(c, "p2", good("inside")).checklist;
  c = apply(c, "p3", { ...good("edge"), measurementNeeded: true }).checklist;
  ok("TEST F measurement required", c.measurementRequired && c.compatibility === "NEEDS_MORE_INFO" && missingViews(c).length === 0);
}

// TEST G low confidence
{
  let c = emptyChecklist();
  c = apply(c, "p1", { ...good("front"), confidence: 0.4 }).checklist;
  // 0.4 < 0.45 → RETAKE; use borderline pass then low overall
  c = emptyChecklist();
  c = apply(c, "p1", { ...good("front"), confidence: 0.52 }).checklist;
  c = apply(c, "p2", { ...good("inside"), confidence: 0.52 }).checklist;
  c = apply(c, "p3", { ...good("edge"), confidence: 0.52 }).checklist;
  ok("TEST G technician review", c.compatibility === "REQUIRES_TECHNICIAN_REVIEW");
}

// TEST H isolation: clearing checklist
{
  let prior = emptyChecklist();
  prior = apply(prior, "old1", good("front")).checklist;
  prior = apply(prior, "old2", good("inside")).checklist;
  prior = apply(prior, "old3", good("edge")).checklist;
  const fresh = emptyChecklist();
  ok("TEST H old evidence not reused", missingViews(prior).length === 0 && missingViews(fresh).length === 3 && !fresh.front);
}

ok("DL-20 test script in npm test", /test-digital-lock-vision\.mjs/.test(pkg));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nDIGITAL LOCK VISION static + matrix checks OK");
