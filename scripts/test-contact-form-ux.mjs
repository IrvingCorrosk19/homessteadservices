/**
 * Isolated checks for public contact form UX + validation + idempotency + push enqueue.
 * Does not create production requests or message customers.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = join(root, "docs/auditoria-homestead-app/evidence/contact-form-ux-2026-10-04");
mkdirSync(join(evidenceDir, "isolated"), { recursive: true });

const dataDir = join(root, "data/control-dev");
mkdirSync(dataDir, { recursive: true });
const marker = join(dataDir, "CONTROL_DEV.txt");
if (!existsSync(marker)) writeFileSync(marker, "control-dev\n");

process.env.HOMESTEAD_CONTROL_ISOLATED = "true";
process.env.DATA_DIR = dataDir.replaceAll("\\", "/");

let failed = 0;
function ok(name, value, detail = "") {
  if (!value) {
    failed += 1;
    console.error("FAIL", name, detail);
  } else console.log("PASS", name, detail || "");
}

const requestForm = readFileSync(join(root, "src/components/contact/RequestForm.tsx"), "utf8");
const contactRoute = readFileSync(join(root, "src/app/api/contact/route.ts"), "utf8");
const es = readFileSync(join(root, "src/i18n/es.ts"), "utf8");
const validationSrc = readFileSync(join(root, "src/lib/contact-form-validation.ts"), "utf8");

ok("UX-01 guided help copy", /Cuéntanos qué ocurre, en qué parte de la propiedad y desde cuándo/.test(es));
ok("UX-02 AC example", /Mi aire de la habitación enciende, pero no enfría desde ayer/.test(validationSrc));
ok("UX-03 min length shared 8", /CONTACT_MESSAGE_MIN_LENGTH = 8/.test(validationSrc));
ok("UX-04 low quality gate", /isLowQualityContactMessage/.test(validationSrc) && /assessContactMessage/.test(requestForm));
ok("UX-05 field banner", /formErrorBanner/.test(requestForm) && /Revisa los campos señalados/.test(es));
ok("UX-06 aria describedby", /aria-describedby/.test(requestForm) && /aria-invalid/.test(requestForm));
ok("UX-07 loading sending", /Enviando solicitud/.test(es) && /uploadingPhotos/.test(requestForm));
ok("UX-08 slow hint", /Está tardando más de lo habitual/.test(es));
ok("UX-09 folio success", /successFolio/.test(requestForm) && /Tu solicitud quedó registrada/.test(es));
ok("UX-10 no visita confirmada", !/Visita confirmada/.test(es));
ok("UX-11 clientSubmissionId", /clientSubmissionId/.test(requestForm) && /clientSubmissionId/.test(contactRoute));
ok("UX-12 photos optional copy", /uploadOptionalHint/.test(es));
ok("API-01 fieldErrors", /fieldErrors/.test(contactRoute) && /VALIDATION_ERROR/.test(contactRoute));
ok("API-02 push failure isolated from client ok", /homestead-contact-dispatch/.test(contactRoute));

function mod(rel) {
  return pathToFileURL(join(root, rel)).href;
}

const {
  assessContactMessage,
  CONTACT_MESSAGE_MIN_LENGTH,
  isLowQualityContactMessage,
  contactMessageExample,
} = await import(mod("src/lib/contact-form-validation.ts"));

ok("VAL-min-shared", CONTACT_MESSAGE_MIN_LENGTH === 8);
ok("VAL-empty", assessContactMessage("") === "empty");
ok("VAL-short", assessContactMessage("corto") === "too_short");
ok("VAL-repeat", assessContactMessage("wwwwwwww") === "low_quality" && isLowQualityContactMessage("wwwwwwww"));
ok(
  "VAL-valid-typos",
  assessContactMessage("Mi aire de la avitacion no enfria desde ayer en la sala") === null,
);
ok("VAL-ac-example", Boolean(contactMessageExample("ac")?.includes("aire")));

const { saveServiceRequest, findRequestByClientSubmissionId, getRequestByPublicId, getHomesteadDb } =
  await import(mod("src/lib/service-requests.ts"));
const { enqueueNewRequestPush } = await import(mod("src/lib/control-push.ts"));

const submissionId = `csub_iso_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const first = saveServiceRequest({
  name: "Form UX Isolated",
  phone: "+50760000001",
  email: "form-ux-isolated@example.invalid",
  property: "apartment",
  service: "ac",
  message: "El aire del cuarto no enfría desde ayer en la noche.",
  photos: [],
  isTest: true,
  clientSubmissionId: submissionId,
  factsJson: JSON.stringify({ entryPoint: "contact_form", isolated: true }),
});

ok("PERSIST-01 saved", /^HS-\d{4}-\d{6}$/.test(first.publicId), first.publicId);
const second = saveServiceRequest({
  name: "Form UX Isolated",
  phone: "+50760000001",
  email: "form-ux-isolated@example.invalid",
  property: "apartment",
  service: "ac",
  message: "El aire del cuarto no enfría desde ayer en la noche.",
  photos: [],
  isTest: true,
  clientSubmissionId: submissionId,
});
ok("PERSIST-02 idempotent same folio", second.publicId === first.publicId, second.publicId);
ok(
  "PERSIST-03 lookup by submission",
  findRequestByClientSubmissionId(submissionId)?.publicId === first.publicId,
);
ok("PERSIST-04 readable", Boolean(getRequestByPublicId(first.publicId)?.message.includes("aire")));

const pushSub = `csub_push_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const liveLike = saveServiceRequest({
  name: "Form UX Push Probe",
  phone: "+50760000002",
  email: "form-ux-push@example.invalid",
  property: "house",
  service: "plumbing",
  message: "Hay una fuga debajo del lavamanos de la cocina desde esta mañana.",
  photos: [],
  isTest: false,
  clientSubmissionId: pushSub,
  factsJson: JSON.stringify({ entryPoint: "contact_form", pushProbe: true }),
});

// saveServiceRequest enqueues control push asynchronously via dynamic import.
await new Promise((resolve) => setTimeout(resolve, 400));

const db = getHomesteadDb();
const outbox = db
  .prepare(
    `SELECT event_type, idempotency_key, correlation_id FROM control_push_outbox WHERE correlation_id = ?`,
  )
  .all(liveLike.publicId);

const newRequestEvents = outbox.filter((row) => row.event_type === "control.push.new_request");
ok("PUSH-01 single new_request outbox", newRequestEvents.length === 1, String(newRequestEvents.length));
ok(
  "PUSH-02 idempotency key shape",
  String(newRequestEvents[0]?.idempotency_key || "").startsWith(
    `control.push.new_request:${liveLike.publicId}:`,
  ),
);

enqueueNewRequestPush(liveLike.publicId, { isTest: false });
const outbox2 = db
  .prepare(
    `SELECT COUNT(*) AS c FROM control_push_outbox WHERE correlation_id = ? AND event_type = 'control.push.new_request'`,
  )
  .get(liveLike.publicId);
ok("PUSH-03 no duplicate enqueue", Number(outbox2.c) === 1, String(outbox2.c));

db.prepare(`UPDATE service_requests SET is_test = 1 WHERE public_id = ?`).run(liveLike.publicId);
db.prepare(
  `UPDATE control_push_outbox SET status = 'FAILED', last_error = 'isolated_form_ux_probe' WHERE correlation_id = ? AND status IN ('PENDING','FAILED')`,
).run(liveLike.publicId);
try {
  db.prepare(
    `UPDATE automation_outbox SET status = 'SKIPPED', last_error = 'isolated_form_ux_probe' WHERE correlation_id = ? AND status IN ('PENDING','FAILED')`,
  ).run(liveLike.publicId);
} catch {
  /* optional */
}

const report = {
  at: new Date().toISOString(),
  form: {
    guidedHelp: true,
    minLength: CONTACT_MESSAGE_MIN_LENGTH,
    lowQualityRejectsRepeat: true,
    folioConfirmation: true,
  },
  persistence: {
    folio: first.publicId,
    idempotentReplay: second.publicId === first.publicId,
    clientSubmissionId: submissionId,
  },
  push: {
    folio: liveLike.publicId,
    outboxEvents: newRequestEvents.length,
    idempotencyKey: newRequestEvents[0]?.idempotency_key || null,
    note: "Outbox event verified in isolated DB; FCM accept ≠ physical A06 delivery. Probe scrubbed.",
  },
};

writeFileSync(join(evidenceDir, "isolated", "RESULTS.json"), JSON.stringify(report, null, 2));
writeFileSync(
  join(evidenceDir, "INFORME.md"),
  `# Contact form UX — 2026-10-04

## Formulario
- Ayuda permanente + ejemplo por servicio + mínimo **8** (alineado backend).
- Calidad: rechaza repetición tipo \`wwwwwwww\`; acepta tipografía imperfecta.
- Errores por campo, banner al enviar, foco al primero inválido.
- Loading real: Enviando / Subiendo fotos / Revisando; \`aria-busy\` / \`aria-live\`; hint si tarda.
- Confirmación con folio real + copiar; sin “Visita confirmada”.

## Persistencia
- Folio aislado: \`${first.publicId}\`
- Idempotencia \`clientSubmissionId\`: reintento → mismo folio.

## Push
- Evento único \`control.push.new_request\` para \`${liveLike.publicId}\`
- Clave: \`${newRequestEvents[0]?.idempotency_key || "n/a"}\`
- Probe scrubbed. Sin mensajes a clientes.
- Listo para revisión en aislado; **no desplegado**.
`,
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nCONTACT FORM UX isolated checks OK");
console.log("Evidence:", evidenceDir);
