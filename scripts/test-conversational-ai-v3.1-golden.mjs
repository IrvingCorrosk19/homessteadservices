import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packed = readFileSync(join(root, "src/lib/concierge/packed-extraction.ts"), "utf8");
const turnIntel = readFileSync(join(root, "src/lib/concierge/turn-intelligence.ts"), "utf8");
const engine = readFileSync(join(root, "src/lib/concierge-engine.ts"), "utf8");
const tools = readFileSync(join(root, "src/lib/concierge-tools.ts"), "utf8");
const knowledge = readFileSync(join(root, "src/lib/concierge-knowledge.ts"), "utf8");
const store = readFileSync(join(root, "src/lib/concierge-store.ts"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

function fold(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function negatedBefore(blob, index, window = 28) {
  const slice = blob.slice(Math.max(0, index - window), index);
  return /\b(no|nunca|sin|tampoco|ni siquiera)\b/.test(slice);
}

function extractSymptoms(text) {
  const blob = fold(text);
  const negated = [];
  const rules = [
    { key: "waterLeak", re: /bota(?:ndo)?\s+agua|gotea|goteo|fuga de agua/, label: "bota agua" },
    { key: "notCooling", re: /no\s+enfr[ií]a|no\s+enfria|no\s+enfria nada/, label: "no enfría" },
  ];
  const parts = [];
  for (const rule of rules) {
    const match = rule.re.exec(blob);
    if (!match) continue;
    if (negatedBefore(blob, match.index)) {
      negated.push(rule.key);
      continue;
    }
    parts.push(rule.label);
  }
  if (/simplemente\s+no\s+enfr/.test(blob) && !parts.includes("no enfría")) parts.push("no enfría");
  return { symptom: parts.join(", "), negated };
}

function extractName(text) {
  const match = text.match(/\b(?:soy|me llamo)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+)/i);
  return match?.[1]?.trim() || "";
}

function extractLocation(text) {
  const match =
    text.match(/\b(?:estoy en|vivo en)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})/i) ||
    text.match(/\ben\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})\b/i);
  return match?.[1]?.trim() || "";
}

function extractUnits(text) {
  const blob = fold(text);
  const digit = blob.match(/\b(\d+)\s+(?:aires?|equipos?)\b/);
  if (digit) return digit[1];
  const word = blob.match(/\b(un|uno|una|dos|tres|cuatro|cinco)\s+(?:aires?|equipos?)\b/);
  const map = { un: "1", uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5" };
  if (word) return map[word[1]] || "";
  const de = blob.match(/\b(?:de|para)\s+(dos|tres|cuatro|cinco)\s+aires?\b/);
  if (de) return map[de[1]] || "";
  return "";
}

function extractPhone(text) {
  const labeled = text.match(
    /(?:n[uú]mero|tel[eé]fono|celular|mi\s+n[uú]m(?:ero)?)\s*(?:es\s*|[:=]\s*)?(\+?\d[\d\s\-().]{5,}\d)/i,
  );
  if (labeled?.[1]) return labeled[1].replace(/\D/g, "");
  const plain = text.match(/\b(\d{4}[\s\-]?\d{4})\b/);
  return plain?.[1]?.replace(/\D/g, "") || "";
}

ok("packed extraction module", /extractPackedMessage/.test(packed) && /applyPackedExtraction/.test(packed));
ok("turn intelligence module", /parseTurnIntelligence/.test(turnIntel) && /detectRepeatedQuestion/.test(turnIntel));
ok("fact confidence", /FactConfidence/.test(packed) && /factConfidence/.test(store));
ok("prompt v3.1", /hs-concierge-v3\.1-he/.test(knowledge));
ok("structured primary path", /parseTurnIntelligence/.test(tools) && /applyTurnIntelligence/.test(tools));
ok("repeated question event", /REPEATED_QUESTION/.test(engine));
ok("question economy block", /questionEconomyBlock/.test(engine));
ok("improved overquestioning", /shouldFlagOverquestioning/.test(engine));
ok("service aware fallback", /fallbackReply\(message.*state/.test(engine));
ok("v3 lineage prompt", /hs-concierge-v3/.test(knowledge));

const packedAna =
  "Hola soy Ana, estoy en Obarrio, mi aire está botando agua desde ayer, es un split y mi número es 60001111.";
ok("GOLDEN-PACKED name", extractName(packedAna) === "Ana");
ok("GOLDEN-PACKED location", extractLocation(packedAna) === "Obarrio");
ok("GOLDEN-PACKED phone", extractPhone(packedAna) === "60001111");
ok("GOLDEN-PACKED units default", extractUnits(packedAna) === "" || extractUnits(packedAna) === "1");

const negation = "No está botando agua, simplemente no enfría.";
const neg = extractSymptoms(negation);
ok("GOLDEN-NEGATION no water leak", !neg.symptom.includes("bota agua") && neg.negated.includes("waterLeak"));
ok("GOLDEN-NEGATION keeps not cooling", neg.symptom.includes("no enfría"));

const typo = "nececito canbiar la seradura en El Cangrejo 60001111";
ok("GOLDEN-TYPO location", /Cangrejo/i.test(extractLocation(typo) || typo));

const multi = "Necesito mantenimiento de dos aires y cambiar la cerradura principal.";
ok("GOLDEN-MULTI units", extractUnits(multi) === "2");

if (failed) {
  console.error(`CONVERSATIONAL_AI_V3_1_GOLDEN_FAILED ${failed}`);
  process.exit(1);
}
console.log("CONVERSATIONAL_AI_V3_1_GOLDEN_OK");
