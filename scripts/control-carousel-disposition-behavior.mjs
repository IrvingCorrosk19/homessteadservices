import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "carousel-disposition");
rmSync(join(dataDir, "homestead.sqlite"), { force: true });
rmSync(join(dataDir, "homestead.sqlite-wal"), { force: true });
rmSync(join(dataDir, "homestead.sqlite-shm"), { force: true });

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (/graph\.facebook|api\.telegram|api\.openai|n8n\.|autonomousflow/i.test(target)) {
    throw new Error(`NETWORK_FORBIDDEN ${target}`);
  }
  return originalFetch(url, init);
};

let failed = 0;
function ok(name, value, detail = "") {
  if (!value) {
    failed += 1;
    console.error("FAIL", name, detail);
  } else console.log("PASS", name, detail);
}

const {
  assertIsolatedSecretsCleared,
  isControlIsolated,
  setSimulatedGraphScenario,
  listSimulatedCalls,
  resetSimulatedCalls,
} = await import("../src/lib/control-isolation.ts");
assertIsolatedSecretsCleared();
ok("isolated", isControlIsolated() === true);

const { getHomesteadDb, saveServiceRequest } = await import("../src/lib/service-requests.ts");
getHomesteadDb();
const { ingestControlPhotos } = await import("../src/lib/control-intake.ts");
const { publishJob } = await import("../src/lib/content-publish.ts");
const { createGraphTransport } = await import("../src/lib/content-meta.ts");
const { getJobByPublicId, tryApproveContentJob, updateJob, listAssets } = await import(
  "../src/lib/content-catalog.ts"
);
const {
  applyServiceRequestDisposition,
  setSecurityReview,
  getServiceRequestDispositionView,
  assertSecurityReviewAllowsBooking,
  buildCustomerDispositionMessage,
} = await import("../src/lib/service-request-disposition.ts");
const { createAppointment } = await import("../src/lib/revenue-store.ts");
const sharp = (await import("sharp")).default;

function jpeg(label) {
  return sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 3,
      background: { r: 30 + (String(label).charCodeAt(0) % 100), g: 60, b: 90 },
    },
  })
    .jpeg()
    .toBuffer();
}

resetSimulatedCalls();
setSimulatedGraphScenario("ok");
{
  const files = [];
  for (const label of ["A", "B", "C"]) {
    files.push({ filename: `synth-${label}.jpg`, bytes: await jpeg(label) });
  }
  const ingested = await ingestControlPhotos({
    files,
    note: "album test",
    actor: "test-runner",
    publishMode: "album",
  });
  ok("album ingest", ingested.ok === true && ingested.publishMode === "album", ingested.publicId || "");
  const publicId = ingested.publicId;
  const job = getJobByPublicId(publicId);
  ok("album format", job?.format === "CAROUSEL" && job?.publishMode === "album");
  const branded = listAssets(publicId, "BRANDED", 1);
  ok("album branded count", branded.length >= 2, String(branded.length));
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: 1, status: "APPROVED" });
  const published = await publishJob(publicId, "now", createGraphTransport());
  ok("album publish ok", published.ok === true, JSON.stringify(published));
  const calls = listSimulatedCalls().filter((c) => c.provider === "meta");
  ok("album meta calls", calls.length >= 3, String(calls.length));
}

{
  const ingested = await ingestControlPhotos({
    files: [
      { filename: "s1.jpg", bytes: await jpeg("S") },
      { filename: "s2.jpg", bytes: await jpeg("T") },
    ],
    note: "separate",
    actor: "test-runner",
    publishMode: "separate",
  });
  const ids = [...new Set(ingested.items.filter((i) => i.ok).map((i) => i.publicId))];
  ok("separate two jobs", ingested.ok === true && ids.length === 2, ids.join(","));
}

{
  const created = saveServiceRequest({
    name: "Cliente Prueba",
    phone: "+50760000001",
    email: "prueba@example.invalid",
    property: "house",
    service: "plumbing",
    message: "Fuga de prueba aislada",
    photos: [],
  });
  const publicId = created.publicId;
  const msg = buildCustomerDispositionMessage({
    kind: "reject",
    reasonCategory: "OUT_OF_COVERAGE",
    name: "Cliente",
  });
  ok("customer msg no secret", !msg.includes("NOTA_INTERNA"));
  const rejected = await applyServiceRequestDisposition({
    requestId: publicId,
    action: "reject",
    actor: "admin-test",
    reasonCategory: "OUT_OF_COVERAGE",
    reason: "Zona no cubierta",
    internalNote: "NOTA_INTERNA_SECRETA_XYZ",
    customerMessage: msg,
    sendCustomerMessage: true,
    confirm: true,
    idempotencyKey: `test-reject-${publicId}`,
  });
  ok("reject ok", rejected.ok === true);
  const view = getServiceRequestDispositionView(publicId);
  ok("reject cancelled", view?.status === "CANCELLED" && view?.dispositionKind === "REJECT");
  ok("internal note stored", view?.internalNote.includes("NOTA_INTERNA_SECRETA_XYZ") === true);
  ok("internal note not in customer draft", view?.customerMessageDraft.includes("NOTA_INTERNA_SECRETA_XYZ") === false);

  const reopen = await applyServiceRequestDisposition({
    requestId: publicId,
    action: "reopen",
    actor: "admin-test",
    reasonCategory: "OTHER",
    confirm: true,
    idempotencyKey: `reopen-${publicId}`,
  });
  ok("reopen", reopen.ok === true && reopen.appointmentRestored === false);

  const setSec = setSecurityReview({
    requestId: publicId,
    actor: "admin-test",
    action: "set",
    reason: "Revisión manual de seguridad operativa",
    confirm: true,
  });
  ok("security set", setSec.ok === true);
  ok("security blocks booking gate", assertSecurityReviewAllowsBooking(publicId).ok === false);
  ok("security blocks createAppointment", createAppointment(publicId, "2099-01-15", "10:00", "CONFIRMED") === null);

  const resolved = setSecurityReview({
    requestId: publicId,
    actor: "admin-test",
    action: "resolve",
    confirm: true,
  });
  ok("security resolve", resolved.ok === true && assertSecurityReviewAllowsBooking(publicId).ok === true);

  // cancel accepted-style path after reopen -> IN_PROGRESS
  const { updateRequestStatus } = await import("../src/lib/service-requests.ts");
  updateRequestStatus(publicId, "IN_PROGRESS");
  const cancelled = await applyServiceRequestDisposition({
    requestId: publicId,
    action: "cancel",
    actor: "admin-test",
    reasonCategory: "OTHER",
    reason: "Cliente no disponible",
    internalNote: "nota privada cancel",
    sendCustomerMessage: false,
    confirm: true,
    idempotencyKey: `cancel-${publicId}`,
  });
  ok("cancel accepted service", cancelled.ok === true && cancelled.newStatus === "CANCELLED");
}

{
  resetSimulatedCalls();
  setSimulatedGraphScenario("fail_facebook");
  const ingested = await ingestControlPhotos({
    files: [
      { filename: "p1.jpg", bytes: await jpeg("P") },
      { filename: "p2.jpg", bytes: await jpeg("Q") },
    ],
    note: "partial",
    actor: "test-runner",
    publishMode: "album",
  });
  const publicId = ingested.publicId;
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: 1, status: "APPROVED" });
  await publishJob(publicId, "now", createGraphTransport());
  const job = getJobByPublicId(publicId);
  ok("partial path recorded", Boolean(job), job?.status || "");
  setSimulatedGraphScenario("ok");
}

if (failed) {
  console.error(`\nCAROUSEL/DISPOSITION failures: ${failed}`);
  process.exit(1);
}
console.log("\nCAROUSEL/DISPOSITION checks OK");
