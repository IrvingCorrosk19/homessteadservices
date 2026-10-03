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

  const targetMessage = `mensaje-unico-${Date.now()}`;
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
    .run(created2.publicId, JSON.stringify({ message: targetMessage }), `conc-${created2.publicId}`, now2, now2);
  resetSimulatedCalls();
  const [d1, d2] = await Promise.all([drainCustomerNotifyOutbox(10), drainCustomerNotifyOutbox(10)]);
  const sent = [...d1, ...d2].filter((r) => r.ok && r.status === "SENT");
  const persisted = getHomesteadDb()
    .prepare(`SELECT status, payload_json FROM service_request_notify_outbox WHERE public_id = ?`)
    .get(created2.publicId);
  const smtpHits = listSimulatedCalls().filter(
    (c) => c.provider === "smtp" && String(c.detail || "").includes(`customer_notify:${created2.publicId}`),
  );
  ok(
    "notify exactly one SENT for target message",
    sent.length === 1 &&
      persisted?.status === "SENT" &&
      String(persisted.payload_json).includes(targetMessage) &&
      smtpHits.length === 1,
    `sent=${sent.length} status=${persisted?.status} smtp=${smtpHits.length}`,
  );

  // Uncertain after accept must not auto-retry to PENDING
  const { setSimulatedNotifyScenario } = await import("../src/lib/control-isolation.ts");
  setSimulatedNotifyScenario("uncertain_after_accept");
  const created3 = saveServiceRequest({
    name: "Notify Uncertain",
    phone: "+50760000097",
    email: "u@example.invalid",
    property: "house",
    service: "plumbing",
    message: "unc",
    photos: [],
  });
  getHomesteadDb()
    .prepare(
      `INSERT INTO service_request_notify_outbox
        (public_id, kind, channel, payload_json, status, idempotency_key, attempts, last_error, created_at, updated_at)
       VALUES (?, 'INFO', 'SIMULATED', ?, 'PENDING', ?, 0, '', ?, ?)`,
    )
    .run(created3.publicId, JSON.stringify({ message: "after-accept" }), `unc-${created3.publicId}`, new Date().toISOString(), new Date().toISOString());
  await drainCustomerNotifyOutbox(5);
  const uncRow = getHomesteadDb()
    .prepare(`SELECT status FROM service_request_notify_outbox WHERE public_id = ?`)
    .get(created3.publicId);
  ok("notify uncertain after accept stays UNCERTAIN", uncRow?.status === "UNCERTAIN", uncRow?.status);
  setSimulatedNotifyScenario("ok");

  // Lease expiry without send → ABANDONED then requeued PENDING; with send_attempted → UNCERTAIN
  const created4 = saveServiceRequest({
    name: "Notify Lease",
    phone: "+50760000096",
    email: "l@example.invalid",
    property: "house",
    service: "plumbing",
    message: "lease",
    photos: [],
  });
  const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO service_request_notify_outbox
        (public_id, kind, channel, payload_json, status, idempotency_key, attempts, last_error, created_at, updated_at, claim_token, lease_until, send_attempted)
       VALUES (?, 'INFO', 'SIMULATED', ?, 'SENDING', ?, 0, '', ?, ?, 'old-token', ?, 0)`,
    )
    .run(created4.publicId, JSON.stringify({ message: "lease-no-send" }), `lease-${created4.publicId}`, past, past, past);
  await drainCustomerNotifyOutbox(5);
  const leaseRow = getHomesteadDb()
    .prepare(`SELECT status FROM service_request_notify_outbox WHERE public_id = ?`)
    .get(created4.publicId);
  ok(
    "notify lease expired without send requeued or SENT once",
    leaseRow?.status === "SENT" || leaseRow?.status === "PENDING" || leaseRow?.status === "ABANDONED",
    leaseRow?.status,
  );
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

  // Two editors same initial revision — second must not overwrite silently
  const ver2 = latestVersion(publicId)?.version || 1;
  const a = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: ver2,
    actor: "editor-a",
    copy: "Editor A wins",
    idempotencyKey: `dual-a-${publicId}`,
  });
  const b = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: ver2,
    actor: "editor-b",
    copy: "Editor B stale",
    idempotencyKey: `dual-b-${publicId}`,
  });
  const jobAfter = getJobByPublicId(publicId);
  ok(
    "two edits same revision one wins",
    a.ok === true && b.ok === false && b.error === "stale_version" && jobAfter?.selectedCaption === "Editor A wins",
    `a=${a.ok} b=${b.error} caption=${jobAfter?.selectedCaption}`,
  );

  // Version absent
  const missing = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: undefined,
    actor: "test",
    copy: "no version",
    idempotencyKey: `nov-${publicId}`,
  });
  ok("version absent rejected", missing.ok === false && (missing.error === "version_required" || missing.error === "stale_version"), missing.error);

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
  // Concurrent regen with edit during openai hold
  const { holdSimulatedOpenAi, releaseSimulatedOpenAi } = await import("../src/lib/control-isolation.ts");
  const { publicId } = await prepareAlbum("regen-race");
  const ver = latestVersion(publicId)?.version || 1;
  holdSimulatedOpenAi();
  const regenPromise = runControlJobAction({
    publicId,
    action: "regenerate_copy",
    version: ver,
    actor: "regen",
    note: "contexto durante espera",
    idempotencyKey: `regen-race-${publicId}`,
  });
  await new Promise((r) => setTimeout(r, 50));
  const editDuring = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: ver,
    actor: "editor",
    copy: "Editado durante regen",
    idempotencyKey: `edit-during-${publicId}`,
  });
  releaseSimulatedOpenAi();
  const regen = await regenPromise;
  const finalCaption = getJobByPublicId(publicId)?.selectedCaption;
  ok(
    "regen concurrent with edit conflicts",
    editDuring.ok === true &&
      regen.ok === false &&
      String(regen.error).includes("conflict") &&
      finalCaption === "Editado durante regen",
    `edit=${editDuring.ok} regen=${regen.error} caption=${finalCaption}`,
  );
}

{
  // Regenerar → version linked to media → approve → publish (album)
  const { getContentVersion, listAssets: listA } = await import("../src/lib/content-catalog.ts");
  const { listOrderedBrandedFeeds, listAllBrandedFeeds } = await import("../src/lib/content-multi-photo.ts");
  const { publicId } = await prepareAlbum("link-media");
  const beforeAssets = listAllBrandedFeeds(publicId).length;
  const ver0 = latestVersion(publicId)?.version || 1;
  const regen = await runControlJobAction({
    publicId,
    action: "regenerate_copy",
    version: ver0,
    actor: "test",
    note: "nuevo texto",
    idempotencyKey: `link-regen-${publicId}`,
  });
  const ver1 = latestVersion(publicId);
  ok(
    "regen creates content_version with media_order",
    regen.ok && ver1?.version > ver0 && Boolean(ver1.mediaOrderJson) && JSON.parse(ver1.mediaOrderJson).length >= 2,
    `v=${ver1?.version} order=${ver1?.mediaOrderJson}`,
  );
  ok("regen keeps branded assets", listAllBrandedFeeds(publicId).length === beforeAssets, String(listAllBrandedFeeds(publicId).length));

  // Remove one photo from carousel
  const orderIds = JSON.parse(ver1.mediaOrderJson);
  const removeId = orderIds[orderIds.length - 1];
  const keepIds = orderIds.slice(0, -1);
  const { applyContentEditAtomic } = await import("../src/lib/content-edit-guard.ts");
  const removed = applyContentEditAtomic({
    publicId,
    expectedVersion: ver1.version,
    kind: "image",
    actor: "test",
    event: "CONTENT_MEDIA_CHANGED",
    copy: getJobByPublicId(publicId).selectedCaption,
    mediaOrderJson: JSON.stringify(keepIds),
    jobPatch: {
      mediaOrderJson: JSON.stringify(keepIds),
      format: keepIds.length >= 2 ? "CAROUSEL" : "SINGLE_IMAGE",
      publishMode: keepIds.length >= 2 ? "album" : "separate",
      approvedVersion: null,
      status: "AWAITING_APPROVAL",
      lastError: "media_changed",
    },
  });
  const ordered = listOrderedBrandedFeeds(publicId, 1, getJobByPublicId(publicId).mediaOrderJson);
  ok(
    "removed photo excluded from order but retained",
    removed.ok &&
      ordered.every((a) => a.id !== removeId) &&
      listAllBrandedFeeds(publicId).some((a) => a.id === removeId),
    `ordered=${ordered.map((a) => a.id)} remove=${removeId}`,
  );

  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: latestVersion(publicId)?.version || 1, status: "APPROVED" });
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const published = await publishJob(publicId, "now", createGraphTransport());
  const igCalls = listSimulatedCalls().filter((c) => c.provider === "meta" && c.request?.isCarouselItem);
  const childCreates = igCalls.length;
  ok(
    "publish uses remaining slides only",
    published.ok === true && childCreates === keepIds.length,
    `ok=${published.ok} children=${childCreates} keep=${keepIds.length}`,
  );
}

{
  // Single image regenerate → approve → publish
  const ingested = await ingestControlPhotos({
    files: [{ filename: "one.jpg", bytes: await jpeg("Z") }],
    note: "single",
    actor: "test-runner",
    publishMode: "separate",
  });
  const publicId = ingested.items.find((i) => i.ok)?.publicId;
  const ver = latestVersion(publicId)?.version || 1;
  const regen = await runControlJobAction({
    publicId,
    action: "regenerate_copy",
    version: ver,
    actor: "test",
    note: "single ctx",
    idempotencyKey: `single-regen-${publicId}`,
  });
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: latestVersion(publicId)?.version || 1, status: "APPROVED" });
  setSimulatedGraphScenario("ok");
  const published = await publishJob(publicId, "now", createGraphTransport());
  ok("single image regen approve publish", regen.ok && published.ok, `regen=${regen.ok} pub=${published.ok}`);
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

{
  // Action receipt lease expiry: expired active → abandoned (row kept), reclaimable by SAME payload only
  const { createHash } = await import("node:crypto");
  const receiptHashOf = (input) =>
    createHash("sha256")
      .update(
        [
          input.key,
          input.publicId,
          input.action,
          input.actor,
          String(input.version),
          input.confirm ? "1" : "0",
          String(input.copy ?? ""),
          String(input.note ?? ""),
        ].join("|"),
      )
      .digest("hex");

  const { publicId } = await prepareAlbum("receipt-lease");
  const key = `lease-op-${publicId}`;
  const past = new Date(Date.now() - 60_000).toISOString();
  const ver = latestVersion(publicId)?.version || 1;
  const reclaimCopy = "Reclaimed after lease expiry";
  const reclaimHash = receiptHashOf({
    key,
    publicId,
    action: "save_copy",
    actor: "new-executor",
    version: ver,
    copy: reclaimCopy,
  });
  getHomesteadDb()
    .prepare(
      `INSERT INTO control_action_receipts
        (idempotency_key, public_id, action, actor, result_json, request_hash, created_at)
       VALUES (?, ?, 'save_copy', 'old-executor', ?, ?, ?)`,
    )
    .run(
      key,
      publicId,
      JSON.stringify({ __pending: true, owner: "old-executor-token", leaseUntil: past, state: "abandoned" }),
      reclaimHash,
      past,
    );
  const reclaim = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: ver,
    actor: "new-executor",
    copy: reclaimCopy,
    idempotencyKey: key,
  });
  const row = getHomesteadDb()
    .prepare(`SELECT result_json FROM control_action_receipts WHERE idempotency_key = ?`)
    .get(key);
  const payload = JSON.parse(row.result_json);
  ok(
    "action receipt past lease reclaimed without DELETE",
    reclaim.ok === true &&
      payload.__pending !== true &&
      getJobByPublicId(publicId)?.selectedCaption === reclaimCopy &&
      Boolean(row),
    `ok=${reclaim.ok} pending=${payload.__pending} caption=${getJobByPublicId(publicId)?.selectedCaption}`,
  );

  // Same key + different payload after abandon → conflict (reservation expired does not clear hash)
  const keyDiff = `lease-diff-${publicId}`;
  const hashA = receiptHashOf({
    key: keyDiff,
    publicId,
    action: "save_copy",
    actor: "old",
    version: latestVersion(publicId)?.version || 1,
    copy: "Payload A",
  });
  getHomesteadDb()
    .prepare(
      `INSERT INTO control_action_receipts
        (idempotency_key, public_id, action, actor, result_json, request_hash, created_at)
       VALUES (?, ?, 'save_copy', 'old', ?, ?, ?)`,
    )
    .run(
      keyDiff,
      publicId,
      JSON.stringify({ __pending: true, owner: "old-a", leaseUntil: past, state: "abandoned" }),
      hashA,
      past,
    );
  const conflictAfterLease = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: latestVersion(publicId)?.version || 1,
    actor: "new",
    copy: "Payload B different",
    idempotencyKey: keyDiff,
  });
  ok(
    "idempotency conflict after lease expiry with different payload",
    conflictAfterLease.ok === false && conflictAfterLease.error === "idempotency_conflict",
    `err=${conflictAfterLease.error}`,
  );

  // Old executor cannot overwrite finished result of newer owner
  const keyRace = `stale-finish-${publicId}`;
  const raceCopy = "Newer executor result";
  const raceVer = latestVersion(publicId)?.version || 1;
  const raceHash = receiptHashOf({
    key: keyRace,
    publicId,
    action: "save_copy",
    actor: "newer",
    version: raceVer,
    copy: raceCopy,
  });
  getHomesteadDb()
    .prepare(
      `INSERT INTO control_action_receipts
        (idempotency_key, public_id, action, actor, result_json, request_hash, created_at)
       VALUES (?, ?, 'save_copy', 'old', ?, ?, ?)`,
    )
    .run(
      keyRace,
      publicId,
      JSON.stringify({ __pending: true, owner: "old-owner-token", leaseUntil: past, state: "abandoned" }),
      raceHash,
      past,
    );
  const newer = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: raceVer,
    actor: "newer",
    copy: raceCopy,
    idempotencyKey: keyRace,
  });
  const beforeOverwrite = getHomesteadDb()
    .prepare(`SELECT result_json FROM control_action_receipts WHERE idempotency_key = ?`)
    .get(keyRace);
  // Simulate late finish from old executor (conditional UPDATE must affect 0 rows)
  const late = getHomesteadDb()
    .prepare(
      `UPDATE control_action_receipts
       SET result_json = ?
       WHERE idempotency_key = ?
         AND request_hash = ?
         AND result_json LIKE '%"__pending":true%'
         AND result_json LIKE '%"state":"active"%'
         AND result_json LIKE ?`,
    )
    .run(JSON.stringify({ ok: false, error: "stale_overwrite" }), keyRace, raceHash, `%"owner":"old-owner-token"%`);
  const afterOverwrite = getHomesteadDb()
    .prepare(`SELECT result_json FROM control_action_receipts WHERE idempotency_key = ?`)
    .get(keyRace);
  ok(
    "old executor cannot overwrite finished newer receipt",
    newer.ok === true &&
      late.changes === 0 &&
      afterOverwrite.result_json === beforeOverwrite.result_json &&
      !String(afterOverwrite.result_json).includes("stale_overwrite"),
    `newer=${newer.ok} changes=${late.changes}`,
  );

  // Stale executor must not finish a receipt owned by another
  const key2 = `stale-owner-${publicId}`;
  const future = new Date(Date.now() + 10 * 60_000).toISOString();
  getHomesteadDb()
    .prepare(
      `INSERT INTO control_action_receipts
        (idempotency_key, public_id, action, actor, result_json, request_hash, created_at)
       VALUES (?, ?, 'save_copy', 'holder', ?, 'hash-stale-2', ?)`,
    )
    .run(
      key2,
      publicId,
      JSON.stringify({ __pending: true, owner: "current-owner", leaseUntil: future, state: "active" }),
      new Date().toISOString(),
    );
  const stale = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: latestVersion(publicId)?.version || 1,
    actor: "stale-executor",
    copy: "Must not overwrite",
    idempotencyKey: key2,
  });
  const row2 = getHomesteadDb()
    .prepare(`SELECT result_json FROM control_action_receipts WHERE idempotency_key = ?`)
    .get(key2);
  const p2 = JSON.parse(row2.result_json);
  ok(
    "stale executor cannot finish stolen receipt",
    stale.ok === false &&
      (stale.error === "idempotency_inflight" || stale.error === "idempotency_conflict") &&
      p2.__pending === true &&
      p2.owner === "current-owner",
    `err=${stale.error} owner=${p2.owner} pending=${p2.__pending}`,
  );
}

{
  // Regen concurrent with publish during OpenAI hold
  const { holdSimulatedOpenAi, releaseSimulatedOpenAi } = await import("../src/lib/control-isolation.ts");
  const { publicId } = await prepareAlbum("regen-pub-race");
  const ver = latestVersion(publicId)?.version || 1;
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: ver, status: "APPROVED" });
  holdSimulatedOpenAi();
  const regenPromise = runControlJobAction({
    publicId,
    action: "regenerate_copy",
    version: ver,
    actor: "regen",
    note: "durante publish",
    idempotencyKey: `regen-pub-${publicId}`,
  });
  await new Promise((r) => setTimeout(r, 50));
  const pubDuring = await runControlJobAction({
    publicId,
    action: "publish_now",
    version: ver,
    actor: "publisher",
    confirm: true,
    idempotencyKey: `pub-during-regen-${publicId}`,
  });
  releaseSimulatedOpenAi();
  const regen = await regenPromise;
  const pubs = listPublicationsForJob(publicId);
  const live = pubs.some((p) => p.status === "PUBLISHED");
  ok(
    "regen concurrent with publish conflicts",
    pubDuring.ok === true &&
      regen.ok === false &&
      String(regen.error).includes("conflict") &&
      live,
    `pub=${pubDuring.ok} regen=${regen.error} live=${live}`,
  );
}

{
  // Notify: lose lease just before send → zero SMTP from old executor
  const { setNotifyPreSendHook, listSimulatedCalls, resetSimulatedCalls } = await import(
    "../src/lib/control-isolation.ts"
  );
  const createdSteal = saveServiceRequest({
    name: "Notify Steal",
    phone: "+50760000097",
    email: "steal@example.invalid",
    property: "house",
    service: "plumbing",
    message: "steal-lease",
    photos: [],
  });
  getHomesteadDb()
    .prepare(
      `INSERT INTO service_request_notify_outbox
        (public_id, kind, channel, payload_json, status, idempotency_key, attempts, last_error, created_at, updated_at)
       VALUES (?, 'INFO', 'SIMULATED', ?, 'PENDING', ?, 0, '', ?, ?)`,
    )
    .run(
      createdSteal.publicId,
      JSON.stringify({ message: "should-not-send" }),
      `steal-${createdSteal.publicId}`,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  resetSimulatedCalls();
  setNotifyPreSendHook(({ id, claimToken }) => {
    getHomesteadDb()
      .prepare(
        `UPDATE service_request_notify_outbox
         SET claim_token = 'stolen-by-other', lease_until = ?, updated_at = ?
         WHERE id = ? AND claim_token = ?`,
      )
      .run(new Date(Date.now() - 60_000).toISOString(), new Date().toISOString(), id, claimToken);
  });
  const drainedSteal = await drainCustomerNotifyOutbox(5);
  setNotifyPreSendHook(null);
  const smtpFromSteal = listSimulatedCalls().filter(
    (c) => c.provider === "smtp" && String(c.detail || "").includes(createdSteal.publicId),
  );
  const stealRow = getHomesteadDb()
    .prepare(`SELECT status, send_attempted, claim_token FROM service_request_notify_outbox WHERE public_id = ?`)
    .get(createdSteal.publicId);
  ok(
    "notify stolen lease before send: zero SMTP",
    smtpFromSteal.length === 0 &&
      drainedSteal.some((r) => r.status === "stolen_or_expired") &&
      Number(stealRow?.send_attempted || 0) === 0,
    `smtp=${smtpFromSteal.length} drain=${JSON.stringify(drainedSteal)} row=${JSON.stringify(stealRow)}`,
  );
}

{
  // Reprocess: each ORIGINAL → new BRANDED (no overwrite); 3 distinct images; atomic version
  const { reprocessControlBrand } = await import("../src/lib/control-intake.ts");
  const { listOrderedBrandedFeeds, listAllBrandedFeeds } = await import("../src/lib/content-multi-photo.ts");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homesteadDataDir } = await import("../src/lib/service-requests.ts");

  const colors = [
    { r: 220, g: 20, b: 20 },
    { r: 20, g: 180, b: 40 },
    { r: 30, g: 40, b: 220 },
  ];
  const files = [];
  for (let i = 0; i < 3; i++) {
    const bytes = await sharp({
      create: { width: 1080, height: 1350, channels: 3, background: colors[i] },
    })
      .jpeg()
      .toBuffer();
    files.push({ filename: `repro-${i + 1}.jpg`, bytes });
  }
  const ingested = await ingestControlPhotos({
    files,
    note: "reprocess-pair-test",
    actor: "test-runner",
    publishMode: "album",
  });
  const publicId = ingested.publicId;
  const originals = listAssets(publicId, "ORIGINAL", 0).sort((a, b) => a.id - b.id);
  const beforeFeeds = listAllBrandedFeeds(publicId);
  const beforePaths = beforeFeeds.map((a) => a.relativePath);
  const beforeSha = beforeFeeds.map((a) => a.sha256);
  const ver0 = latestVersion(publicId)?.version || 1;
  const order0 = JSON.parse(getJobByPublicId(publicId)?.mediaOrderJson || "[]");

  const rep = await reprocessControlBrand(publicId, ver0);
  const ver1 = latestVersion(publicId);
  const afterFeeds = listAllBrandedFeeds(publicId);
  const order1 = JSON.parse(getJobByPublicId(publicId)?.mediaOrderJson || "[]");
  const ordered = listOrderedBrandedFeeds(publicId, ver1?.version || 0, getJobByPublicId(publicId)?.mediaOrderJson);
  const newAssets = afterFeeds.filter((a) => order1.includes(a.id));
  const oldStillExist = beforePaths.every((p) => existsSync(join(homesteadDataDir(), "content", p)));
  const shasDistinct = new Set(newAssets.map((a) => a.sha256)).size;
  ok(
    "reprocess pairs each original to new branded without overwrite",
    rep.ok === true &&
      originals.length === 3 &&
      order1.length === 3 &&
      order1.every((id) => !order0.includes(id)) &&
      newAssets.length === 3 &&
      oldStillExist &&
      beforeSha.every((s) => afterFeeds.some((a) => a.sha256 === s)) &&
      ver1?.version === ver0 + 1 &&
      ordered.length === 3 &&
      shasDistinct === 3,
    `ok=${rep.ok} v=${ver1?.version} order0=${order0} order1=${order1} shas=${shasDistinct} oldExist=${oldStillExist}`,
  );

  // Conflict: concurrent version bump keeps current selection intact
  const verNow = latestVersion(publicId)?.version || 1;
  const orderBeforeConflict = getJobByPublicId(publicId)?.mediaOrderJson;
  const { applyContentEditAtomic } = await import("../src/lib/content-edit-guard.ts");
  applyContentEditAtomic({
    publicId,
    expectedVersion: verNow,
    kind: "copy",
    actor: "concurrent",
    event: "CONTENT_EDITED",
    copy: "bumped during reprocess",
    jobPatch: { selectedCaption: "bumped during reprocess", approvedVersion: null, status: "AWAITING_APPROVAL" },
  });
  const conflicted = await reprocessControlBrand(publicId, verNow);
  ok(
    "reprocess conflict keeps current version intact",
    conflicted.ok === false &&
      (String(conflicted.error).includes("conflict") || conflicted.error === "stale_version") &&
      getJobByPublicId(publicId)?.mediaOrderJson === orderBeforeConflict &&
      latestVersion(publicId)?.version === verNow + 1,
    `err=${conflicted.error} order=${getJobByPublicId(publicId)?.mediaOrderJson}`,
  );
}

if (failed) {
  console.error(`\nCAROUSEL/DISPOSITION failures: ${failed}`);
  process.exit(1);
}
console.log("\nCAROUSEL/DISPOSITION checks OK");
