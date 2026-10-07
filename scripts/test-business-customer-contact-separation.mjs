/**
 * Customer vs business contact separation + lockout continuity.
 * [simulacion] — no real Meta/Telegram; fictional phones only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const evidenceDir = join(root, "docs", "auditoria-homestead-app", "evidence", `biz-customer-sep-${stamp}`);
mkdirSync(evidenceDir, { recursive: true });

const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "biz-customer-sep");

// Official WA stays from site.ts; ensure phone env is a known business number for tests.
process.env.NEXT_PUBLIC_PHONE = "+507 6000-1111";
process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP = "true";

let failed = 0;
const lines = [];
function ok(name, value, detail = "") {
  const row = `${value ? "PASS" : "FAIL"} [simulacion] ${name}${detail ? ` · ${detail}` : ""}`;
  lines.push(row);
  if (!value) {
    failed += 1;
    console.error(row);
  } else console.log(row);
}

const {
  getBusinessContactChannels,
  isBusinessContactQuestion,
  formatBusinessContactReply,
  replyLeaksCustomerPhoneAsBusiness,
  scrubCustomerPhoneLeak,
} = await import("../src/lib/concierge/business-contact.ts");
const { answerOperationsQuestion } = await import("../src/lib/concierge/operations-qa.ts");
const { serializeFactGraph, buildFactGraph } = await import("../src/lib/concierge/fact-model.ts");
const { buildConversationSummary } = await import("../src/lib/concierge/conversation-summary.ts");
const { detectLockoutIntent, getServiceRequirements } = await import("../src/lib/service-requirements.ts");
const { shouldOfferAvailability } = await import("../src/lib/concierge/playbook-engine.ts");
const { getPlaybook } = await import("../src/lib/concierge/service-playbooks.ts");
const { conciergeSystemPrompt, conciergeKnowledge, CONCIERGE_BUILD_MARKER } = await import(
  "../src/lib/concierge-knowledge.ts"
);
const { applyNaturalStyleGuard } = await import("../src/lib/concierge/natural-style.ts");

const CUSTOMER_A = "+50761112222";
const CUSTOMER_B = "+50763334444";
const BUSINESS_PHONE = "+507 6000-1111";

ok("build marker", CONCIERGE_BUILD_MARKER.includes("bizsep"), CONCIERGE_BUILD_MARKER);

{
  const ch = getBusinessContactChannels();
  ok("business phone from config", ch.phone === BUSINESS_PHONE, ch.phone || "");
  ok("business whatsapp official", Boolean(ch.whatsappDisplay?.includes("6661")), ch.whatsappDisplay || "");
  ok("business never equals customer A", ch.phone?.replace(/\D/g, "") !== CUSTOMER_A.replace(/\D/g, ""));
}

{
  ok("q: cuál es el número", isBusinessContactQuestion("cuál es el número"));
  ok("q: teléfono de ustedes", isBusinessContactQuestion("me pasan el teléfono de ustedes"));
  ok("q: whatsapp homestead", isBusinessContactQuestion("cuál es el whatsapp de homestead"));
  ok("not q: te paso mi número", !isBusinessContactQuestion("te paso mi número 6111-2222"));
  ok("not q: mi teléfono es", !isBusinessContactQuestion("mi teléfono es 61112222"));
}

{
  const ans = answerOperationsQuestion("cuál es el número");
  ok("ops handled", ans.handled);
  ok("ops uses business not customer", !ans.reply.includes("6111") && !ans.reply.includes("61112222"), ans.reply.slice(0, 120));
  ok("ops mentions homestead or whatsapp", /homestead|whats?app|6000-1111|6661/i.test(ans.reply), ans.reply.slice(0, 120));
}

{
  delete process.env.NEXT_PUBLIC_PHONE;
  // Re-import won't reload; call format with env cleared via getBusinessContactChannels after mutating contact is hard.
  // Simulate absent phone by checking format when only WA exists — phone env was set; use scrub path instead.
  process.env.NEXT_PUBLIC_PHONE = "";
  // site.ts contact is evaluated at import — use formatBusinessContactReply which reads live contact.
  // For absent commercial: replyLeaks scrub + explicit message path.
  const leak = scrubCustomerPhoneLeak(
    `El número de Homestead es ${CUSTOMER_A}`,
    CUSTOMER_A,
  );
  ok("scrub replaces customer-as-business", leak.scrubbed && !leak.reply.includes("61112222"), leak.reply.slice(0, 140));
  process.env.NEXT_PUBLIC_PHONE = BUSINESS_PHONE;
}

{
  const state = {
    name: "Ana Prueba",
    phone: CUSTOMER_A,
    contactStatus: "VALID",
    location: "San Miguelito",
    primaryService: "locksmith",
    facts: {},
    factConfidence: { phone: "EXPLICIT", name: "EXPLICIT" },
  };
  const graph = buildFactGraph(state);
  const ser = serializeFactGraph(graph);
  ok("fact graph masks phone digits", !ser.includes("61112222") && ser.includes("[customer_phone_on_file]"), ser);
  const summary = buildConversationSummary(state, {
    goal: "REQUEST_SERVICE",
    goals: [],
    understanding: "",
    reasoningSummary: "",
    missingCriticalInformation: [],
    assumptions: [],
    riskFlags: [],
    recommendedActions: [],
    toolPlan: [],
    responseStrategy: "",
    factGraphSummary: ser,
  });
  ok("summary no raw phone", !summary.confirmedFacts.some((f) => f.includes("6111")), summary.confirmedFacts.join("|"));
}

{
  ok(
    "lockout: me puedan abrir la puerta",
    detectLockoutIntent("necesito me puedan abrir la puerta de mi casa"),
  );
  ok("lockout: quedé afuera", detectLockoutIntent("me quedé afuera sin llave"));
  const req = getServiceRequirements({
    service: "locksmith",
    message: "necesito me puedan abrir la puerta de mi casa",
  });
  ok("lockout no required photos", req.intentId === "lockout" && req.requiredPhotos === false, req.intentId);
  const playbook = getPlaybook("locksmith");
  const state = {
    photoCount: 0,
    facts: { serviceIntent: "lockout", lockedOut: "1" },
    primaryService: "locksmith",
    service: "locksmith",
  };
  ok("lockout can offer availability without photos", shouldOfferAvailability(playbook, state));
}

{
  const dirty = `Puedes llamar a Homestead al ${CUSTOMER_A}`;
  ok("leak detected", replyLeaksCustomerPhoneAsBusiness(dirty, CUSTOMER_A));
  const style = applyNaturalStyleGuard(dirty, {
    name: "Ana",
    phone: CUSTOMER_A,
    contactStatus: "VALID",
    facts: {},
  });
  ok(
    "style guard scrubs",
    style.styleFlags.includes("customer_phone_business_leak_scrubbed") &&
      !style.reply.replace(/\D/g, "").includes("61112222"),
    style.reply.slice(0, 120),
  );
}

{
  const prompt = conciergeSystemPrompt(conciergeKnowledge());
  ok("prompt has business separation", /SEPARACIÓN ESTRICTA|customer\.phone/i.test(prompt));
  ok("prompt has verified contact lines", /Teléfono comercial|WhatsApp comercial/i.test(prompt));
  ok("prompt never contains customer A", !prompt.includes("61112222"));
}

// Two-session isolation: business channels identical; customer phones stay distinct in state (unit-level).
{
  const a = { phone: CUSTOMER_A, contactStatus: "VALID", name: "Cliente A", facts: {}, factConfidence: {} };
  const b = { phone: CUSTOMER_B, contactStatus: "VALID", name: "Cliente B", facts: {}, factConfidence: {} };
  const sa = serializeFactGraph(buildFactGraph(a));
  const sb = serializeFactGraph(buildFactGraph(b));
  ok("session A masked", sa.includes("[customer_phone_on_file]") && !sa.includes("61112222"));
  ok("session B masked", sb.includes("[customer_phone_on_file]") && !sb.includes("63334444"));
  const qa = formatBusinessContactReply().reply;
  const qb = formatBusinessContactReply().reply;
  ok("business reply identical across sessions", qa === qb);
  ok("business reply has no A or B digits", !qa.includes("6111") && !qa.includes("6333"), qa.slice(0, 100));
}

const transcript = {
  scenario: "fictitious door-open + ask homestead number",
  customerPhoneUsedInTest: CUSTOMER_A,
  businessPhoneConfigured: BUSINESS_PHONE,
  turns: [
    { user: "necesito me puedan abrir la puerta de mi casa", note: "lockout intent" },
    { user: "Ana Prueba", note: "name" },
    { user: CUSTOMER_A, note: "customer phone — never business" },
    { user: "san mi guelito frente al colegio republica de colombia", note: "location typos ok" },
    { user: "cuál es el número", note: "must answer business contact only" },
  ],
  expected: {
    lockout: true,
    noInteriorPhotosRequired: true,
    businessContactNotCustomer: true,
    continueRegistration: true,
  },
};

writeFileSync(join(evidenceDir, "results.txt"), lines.join("\n") + `\nfailed=${failed}\n`, "utf8");
writeFileSync(join(evidenceDir, "scenario.json"), JSON.stringify(transcript, null, 2), "utf8");
console.log(`\nEvidence: ${evidenceDir}`);
console.log(failed ? `FAILED ${failed}` : "ALL PASS [simulacion]");
process.exit(failed ? 1 : 0);
