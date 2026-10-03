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
    console.error("FAIL", "[simulacion]", name, detail);
  } else console.log("PASS", "[simulacion]", name, detail);
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
const {
  getJobByPublicId,
  tryApproveContentJob,
  updateJob,
  listAssets,
  listPublicationsForJob,
  latestVersion,
} = await import("../src/lib/content-catalog.ts");
const {
  applyServiceRequestDisposition,
  setSecurityReview,
  getServiceRequestDispositionView,
  assertSecurityReviewAllowsBooking,
  buildCustomerDispositionMessage,
  drainCustomerNotifyOutbox,
} = await import("../src/lib/service-request-disposition.ts");
const { createAppointment } = await import("../src/lib/revenue-store.ts");
const { runControlJobAction } = await import("../src/lib/control-service.ts");
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

async function prepareAlbum(note) {
  const files = [];
  for (const label of ["A", "B", "C"]) {
    files.push({ filename: `synth-${label}.jpg`, bytes: await jpeg(label) });
  }
  const ingested = await ingestControlPhotos({
    files,
    note,
    actor: "test-runner",
    publishMode: "album",
  });
  const publicId = ingested.publicId;
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: 1, status: "APPROVED" });
  return { ingested, publicId };
}

resetSimulatedCalls();
setSimulatedGraphScenario("ok");
{
  const { ingested, publicId } = await prepareAlbum("album test");
  ok("album ingest", ingested.ok === true && ingested.publishMode === "album", publicId || "");
  const job = getJobByPublicId(publicId);
  ok("album format", job?.format === "CAROUSEL" && job?.publishMode === "album");
  const branded = listAssets(publicId, "BRANDED", 1);
  ok("album branded count", branded.length >= 2, String(branded.length));
  const published = await publishJob(publicId, "now", createGraphTransport());
  ok("album publish ok", published.ok === true, JSON.stringify(published));
  const ig = listPublicationsForJob(publicId).find((p) => p.platform === "instagram");
  const containerId = ig?.container_id || "";
  ok("parent container not child", Boolean(containerId) && !String(containerId).startsWith("sim-child-"), containerId);
  const calls = listSimulatedCalls().filter((c) => c.provider === "meta");
  ok("album meta calls", calls.length >= 3, String(calls.length));
}

for (const scenario of ["fail_ig_second_child", "fail_ig_child_wait", "fail_ig_carousel_parent"]) {
  resetSimulatedCalls();
  setSimulatedGraphScenario(scenario);
  const { publicId } = await prepareAlbum(`ig-fail-${scenario}`);
  const first = await publishJob(publicId, "now", createGraphTransport());
  ok(`${scenario} fails`, first.ok === false, JSON.stringify(first));
  const pubsFail = listPublicationsForJob(publicId).filter((p) => p.platform === "instagram");
  ok(
    `${scenario} no child as parent`,
    pubsFail.every((p) => !String(p.container_id || "").startsWith("sim-child-")),
  );
  setSimulatedGraphScenario("ok");
  updateJob(publicId, { status: "APPROVED", lastError: null, approvedVersion: 1 });
  getHomesteadDb()
    .prepare(`UPDATE content_publications SET status = 'FAILED', container_id = '' WHERE public_id = ? AND platform = 'instagram'`)
    .run(publicId);
  const recovered = await publishJob(publicId, "now", createGraphTransport());
  const ig = listPublicationsForJob(publicId).find((p) => p.platform === "instagram");
  ok(`${scenario} recovers`, recovered.ok === true && ig?.status === "PUBLISHED" && !String(ig.container_id).startsWith("sim-child-"));
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
  const { publicId } = await prepareAlbum("partial");
  await publishJob(publicId, "now", createGraphTransport());
  const pubs = listPublicationsForJob(publicId);
  const igOk = pubs.some((p) => p.platform === "instagram" && p.status === "PUBLISHED");
  const fbFail = pubs.some((p) => p.platform === "facebook" && p.status === "FAILED");
  ok("partial IG ok AND FB fail", igOk && fbFail, pubs.map((p) => `${p.platform}:${p.status}`).join(","));

  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const retry = await publishJob(publicId, "now", createGraphTransport());
  const results = retry.results || [];
  ok(
    "partial retry skips IG republish",
    retry.ok === true &&
      results.some((r) => r.platform === "instagram" && r.outcome === "already") &&
      results.some((r) => r.platform === "facebook" && r.outcome === "published"),
    JSON.stringify(results),
  );
}

{
  const created = saveServiceRequest({
    name: "Notify WA",
    phone: "+50760000099",
    email: "",
    property: "house",
    service: "ac",
    message: "notify",
    photos: [],
  });
  const now = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO service_request_notify_outbox
        (public_id, kind, channel, payload_json, status, idempotency_key, attempts, last_error, created_at, updated_at)
       VALUES (?, 'REJECT', 'WHATSAPP_LINK', ?, 'PENDING', ?, 0, '', ?, ?)`,
    )
    .run(created.publicId, JSON.stringify({ message: "Borrador WA" }), `wa-${created.publicId}`, now, now);
  await Promise.all([drainCustomerNotifyOutbox(5), drainCustomerNotifyOutbox(5)]);
  const row = getHomesteadDb()
    .prepare(`SELECT status FROM service_request_notify_outbox WHERE public_id = ?`)
    .get(created.publicId);
  ok("whatsapp assisted never SENT", row?.status !== "SENT" && (row?.status === "NEEDS_ACTION" || row?.status === "DRAFT"), row?.status);

  const created2 = saveServiceRequest({
    name: "Notify Conc",
    phone: "+50760000098",
    email: "c@example.invalid",
    property: "house",
    service: "plumbing",
    message: "conc",
    photos: [],
  });
  const now2 = new Date().toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO service_request_notify_outbox
        (public_id, kind, channel, payload_json, status, idempotency_key, attempts, last_error, created_at, updated_at)
       VALUES (?, 'INFO', 'SIMULATED', ?, 'PENDING', ?, 0, '', ?, ?)`,
    )
    .run(created2.publicId, JSON.stringify({ message: "hola" }), `conc-${created2.publicId}`, now2, now2);
  const [d1, d2] = await Promise.all([drainCustomerNotifyOutbox(10), drainCustomerNotifyOutbox(10)]);
  const sent = [...d1, ...d2].filter((r) => r.ok && r.status === "SENT");
  ok("notify atomic claim concurrent", new Set(sent.map((r) => r.id)).size >= 1, String(sent.length));
}

{
  const { publicId } = await prepareAlbum("idem");
  const ver = latestVersion(publicId)?.version || 1;
  const key = `idem-save-${publicId}`;
  const first = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: ver,
    actor: "test",
    copy: "Caption A",
    note: "ctx-a",
    idempotencyKey: key,
  });
  const conflict = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: latestVersion(publicId)?.version || ver,
    actor: "test",
    copy: "Caption B different",
    note: "ctx-a",
    idempotencyKey: key,
  });
  ok("idempotency conflict on different copy", first.ok === true && conflict.ok === false && conflict.error === "idempotency_conflict");

  await runControlJobAction({
    publicId,
    action: "regenerate_copy",
    version: latestVersion(publicId)?.version || 1,
    actor: "test",
    note: "instruccion operador no literal",
    idempotencyKey: `regen-${publicId}`,
  });
  const current = latestVersion(publicId)?.version || 0;
  const stale = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: Math.max(1, current - 1),
    actor: "test",
    copy: "obsolete",
    idempotencyKey: `stale-${publicId}`,
  });
  ok("stale version edit rejected", stale.ok === false && stale.error === "stale_version", stale.error);
  const job = getJobByPublicId(publicId);
  ok("copy not literal operator note", job?.selectedCaption?.trim() !== "instruccion operador no literal");
}

{
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const { publicId } = await prepareAlbum("concurrent");
  const ver = latestVersion(publicId)?.version || 1;
  const [a, b] = await Promise.all([
    runControlJobAction({
      publicId,
      action: "publish_now",
      version: ver,
      actor: "worker-a",
      confirm: true,
      idempotencyKey: `pub-a-${publicId}`,
    }),
    runControlJobAction({
      publicId,
      action: "publish_now",
      version: ver,
      actor: "worker-b",
      confirm: true,
      idempotencyKey: `pub-b-${publicId}`,
    }),
  ]);
  const ig = listPublicationsForJob(publicId).filter((p) => p.platform === "instagram" && p.status === "PUBLISHED");
  ok("concurrent publish single IG", ig.length <= 1 && (a.ok || b.ok), `ig=${ig.length} a=${a.ok} b=${b.ok}`);
}

if (failed) {
  console.error(`\nCAROUSEL/DISPOSITION failures: ${failed}`);
  process.exit(1);
}
console.log("\nCAROUSEL/DISPOSITION checks OK");
