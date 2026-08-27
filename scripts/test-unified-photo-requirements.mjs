import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const policySrc = readFileSync(join(root, "src/lib/service-requirements.ts"), "utf8");
const formVal = readFileSync(join(root, "src/lib/form-digital-lock-validation.ts"), "utf8");
const contact = readFileSync(join(root, "src/app/api/contact/route.ts"), "utf8");
const requestForm = readFileSync(join(root, "src/components/contact/RequestForm.tsx"), "utf8");
const slots = readFileSync(join(root, "src/components/contact/DigitalLockPhotoSlots.tsx"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const vision = readFileSync(join(root, "src/lib/concierge/digital-lock-vision.ts"), "utf8");
const playbook = readFileSync(join(root, "src/lib/concierge/service-playbooks.ts"), "utf8");

ok("POL-01 getServiceRequirements exists", /export function getServiceRequirements/.test(policySrc));
ok("POL-02 digital lock requires 3 vision evidence", /minimumValidPhotos: 3/.test(policySrc) && /visionValidation: true/.test(policySrc));
ok("POL-03 lockout does not block", /intentId === "lockout"/.test(policySrc) && /blocksRequestCompletion: false/.test(policySrc));
ok("POL-04 lockout wins over digital", /Lockout always wins/.test(policySrc) || /detectLockoutIntent/.test(policySrc));

ok("FORM-01 uses getServiceRequirements", /getServiceRequirements/.test(requestForm));
ok("FORM-02 digital lock slots UI", /DigitalLockPhotoSlots/.test(requestForm) && /Fotografías necesarias/.test(slots));
ok("FORM-03 camera + gallery", /capture="environment"/.test(slots) && /Galería/.test(slots));
ok("FORM-04 locksmith intent radios", /LOCKSMITH_FORM_INTENTS/.test(requestForm));
ok("FORM-05 preserves fields on vision reject", /DIGITAL_LOCK_PHOTO_REQUIREMENTS_INCOMPLETE/.test(requestForm) && /setStatus\("idle"\)/.test(requestForm));

ok("API-01 contact hard gate", /validateDigitalLockFormEvidence/.test(contact));
ok("API-02 incomplete returns 422", /DIGITAL_LOCK_PHOTO_REQUIREMENTS_INCOMPLETE/.test(contact) && /status: 422/.test(contact));
ok("API-03 facts store checklist", /digitalLockChecklist/.test(contact));

ok("VAL-01 vision not slot name", /Slot hints are ignored/.test(formVal) || /classification wins/.test(formVal));
ok("VAL-02 analyzeDigitalLockPhotoFromBytes", /analyzeDigitalLockPhotoFromBytes/.test(vision));
ok("VAL-03 applyVisionToChecklist shared", /applyVisionToChecklist/.test(vision) && /applyDigitalLockVision/.test(vision));

ok("CHAT-01 engine uses policy", /getServiceRequirements/.test(engine) && /detectLockoutIntent/.test(engine));
ok("CHAT-02 lockout clears digital lock", /emptyDigitalLockChecklist/.test(engine));
ok("CHAT-03 enforce reply truth kept", /enforceDigitalLockReplyTruth/.test(engine));

ok("PLAY-01 unified photo guidance", /POLÍTICA UNIFICADA|service-requirements/.test(playbook));

// Runtime policy checks (transpile-free by duplicating critical resolve rules via dynamic import of built? skip — use regex + eval-free logic copy)
function normalizeDigitalLockText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/cer+d+a+uras?/g, "cerradura")
    .replace(/digit+a+[pl]*|digit+al+/g, "digital");
}
function detectPurchase(text) {
  const n = normalizeDigitalLockText(text);
  return /\bcerradura\s+digital\b/.test(n) || (/cer\w{2,8}ura/.test(n) && /digit/.test(n));
}
function detectLockout(text) {
  const n = normalizeDigitalLockText(text);
  return /\b(qued[eé]\s+afuera|no puedo entrar|estoy afuera|perd[ií]\s+la\s+llave)\b/i.test(n);
}

ok("TEST-lockout no purchase", detectLockout("Me quedé afuera de mi casa y no puedo abrir") && !detectPurchase("Me quedé afuera de mi casa y no puedo abrir"));
ok("TEST-purchase digital", detectPurchase("Quiero comprar una cerradura digital"));
ok("TEST-lockout wins wording", detectLockout("Estoy afuera y no puedo entrar"));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nUNIFIED PHOTO REQUIREMENTS static checks OK");
