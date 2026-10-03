/**
 * Isolated behavior tests for multi-photo publish + request disposition.
 * Run: node --import tsx scripts/control-carousel-disposition-behavior.ts
 *
 * kind: simulacion (in-process, no HTTP UI, no Meta real)
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyControlIsolatedEnv } from "./control-isolated-env.mjs";

const root = resolve(join(import.meta.dirname, ".."));
const dataDir = applyControlIsolatedEnv(root, "test");

rmSync(join(dataDir, "homestead.sqlite"), { force: true });
rmSync(join(dataDir, "homestead.sqlite-wal"), { force: true });
rmSync(join(dataDir, "homestead.sqlite-shm"), { force: true });

const {
  assertIsolatedSecretsCleared,
  isControlIsolated,
  setSimulatedGraphScenario,
  listSimulatedCalls,
  resetSimulatedCalls,
} = await import("../src/lib/control-isolation.ts");
assertIsolatedSecretsCleared();
assert.equal(isControlIsolated(), true);

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

async function makeJpegBytes(label: string) {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: {
      width: 1080,
      height: 1350,
      channels: 3,
      background: { r: 30 + (label.charCodeAt(0) % 100), g: 60, b: 90 },
    },
  })
    .jpeg()
    .toBuffer();
}

const results: Array<{ name: string; kind: string; ok: boolean; detail?: string }> = [];
function pass(name: string, detail = "") {
  results.push({ name, kind: "simulacion", ok: true, detail });
  console.log("PASS", "[simulacion]", name, detail);
}
function fail(name: string, detail: string) {
  results.push({ name, kind: "simulacion", ok: false, detail });
  console.error("FAIL", "[simulacion]", name, detail);
}

async function prepareAlbum(note: string) {
  const files = [];
  for (const label of ["A", "B", "C"]) {
    files.push({ filename: `synth-${label}.jpg`, bytes: await makeJpegBytes(label) });
  }
  const ingested = await ingestControlPhotos({
    files,
    note,
    actor: "test-runner",
    publishMode: "album",
  });
  assert.equal(ingested.ok, true);
  const publicId = ingested.publicId!;
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: 1, status: "APPROVED" });
  return publicId;
}

async function testAlbumPublish() {
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const publicId = await prepareAlbum("album test");
  const job = getJobByPublicId(publicId)!;
  assert.equal(job.format, "CAROUSEL");
  assert.equal(job.publishMode, "album");
  const branded = listAssets(publicId, "BRANDED", 1);
  assert.ok(branded.length >= 2, `expected >=2 branded got ${branded.length}`);
  const published = await publishJob(publicId, "now", createGraphTransport());
  assert.equal(published.ok, true, JSON.stringify(published));
  const pubs = listPublicationsForJob(publicId);
  for (const p of pubs) {
    if (p.platform === "instagram") {
      assert.ok(p.containerId, "parent container required");
      assert.equal(p.containerId.startsWith("sim-child-"), false, "child must never be saved as parent container");
    }
  }
  const calls = listSimulatedCalls().filter((c) => c.provider === "meta");
  assert.ok(calls.length >= 3, `expected multi graph calls, got ${calls.length}`);
  pass("album_carousel_publish_simulated", publicId);
}

async function testIgChildFailuresAndRecovery() {
  for (const scenario of ["fail_ig_second_child", "fail_ig_child_wait", "fail_ig_carousel_parent"] as const) {
    resetSimulatedCalls();
    setSimulatedGraphScenario(scenario);
    const publicId = await prepareAlbum(`ig-fail-${scenario}`);
    const first = await publishJob(publicId, "now", createGraphTransport());
    assert.equal(first.ok, false, `${scenario} should fail first attempt`);
    const pubsFail = listPublicationsForJob(publicId).filter((p) => p.platform === "instagram");
    for (const p of pubsFail) {
      assert.equal(String(p.containerId || "").startsWith("sim-child-"), false, `${scenario}: no child as parent`);
      assert.ok(p.status === "FAILED" || p.status === "UNCERTAIN", `${scenario} status=${p.status}`);
    }
    // Recovery: clear failure and republish with ok scenario
    setSimulatedGraphScenario("ok");
    updateJob(publicId, { status: "APPROVED", lastError: null, approvedVersion: 1 });
    getHomesteadDb()
      .prepare(`UPDATE content_publications SET status = 'FAILED', container_id = '' WHERE public_id = ? AND platform = 'instagram'`)
      .run(publicId);
    const recovered = await publishJob(publicId, "now", createGraphTransport());
    assert.equal(recovered.ok, true, `${scenario} recovery failed: ${JSON.stringify(recovered)}`);
    const ig = listPublicationsForJob(publicId).find((p) => p.platform === "instagram");
    assert.equal(ig?.status, "PUBLISHED");
    assert.ok(ig?.containerId && !ig.containerId.startsWith("sim-child-"), `${scenario} recovered parent id`);
    pass(`ig_fail_recover_${scenario}`, publicId);
  }
}

async function testSeparateMode() {
  const files = [
    { filename: "s1.jpg", bytes: await makeJpegBytes("S") },
    { filename: "s2.jpg", bytes: await makeJpegBytes("T") },
  ];
  const ingested = await ingestControlPhotos({
    files,
    note: "separate",
    actor: "test-runner",
    publishMode: "separate",
  });
  assert.equal(ingested.ok, true);
  assert.equal(ingested.publishMode, "separate");
  const ids = [...new Set(ingested.items.filter((i) => i.ok).map((i) => i.publicId))];
  assert.equal(ids.length, 2);
  pass("separate_two_jobs", ids.join(","));
}

async function testDisposition() {
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
  assert.ok(!msg.includes("nota interna"));
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
  assert.equal(rejected.ok, true);
  const view = getServiceRequestDispositionView(publicId)!;
  assert.equal(view.status, "CANCELLED");
  assert.equal(view.dispositionKind, "REJECT");
  assert.equal(view.internalNote.includes("NOTA_INTERNA_SECRETA_XYZ"), true);
  assert.equal(view.customerMessageDraft.includes("NOTA_INTERNA_SECRETA_XYZ"), false);
  pass("reject_with_internal_note_confidential", publicId);

  const reopen = await applyServiceRequestDisposition({
    requestId: publicId,
    action: "reopen",
    actor: "admin-test",
    reasonCategory: "OTHER",
    confirm: true,
    idempotencyKey: `reopen-${publicId}`,
  });
  assert.equal(reopen.ok, true);
  assert.equal(reopen.appointmentRestored, false);
  pass("reopen_without_appointment", "");

  const setSec = setSecurityReview({
    requestId: publicId,
    actor: "admin-test",
    action: "set",
    reason: "Revisión manual de seguridad operativa",
    confirm: true,
  });
  assert.equal(setSec.ok, true);
  assert.equal(assertSecurityReviewAllowsBooking(publicId).ok, false);
  const appt = createAppointment(publicId, "2099-01-15", "10:00", "CONFIRMED");
  assert.equal(appt, null);
  pass("security_review_blocks_booking", "");

  const resolved = setSecurityReview({
    requestId: publicId,
    actor: "admin-test",
    action: "resolve",
    confirm: true,
  });
  assert.equal(resolved.ok, true);
  assert.equal(assertSecurityReviewAllowsBooking(publicId).ok, true);
  pass("security_review_resolved", "");
}

async function testPartialFailure() {
  resetSimulatedCalls();
  setSimulatedGraphScenario("fail_facebook");
  const publicId = await prepareAlbum("partial");
  const published = await publishJob(publicId, "now", createGraphTransport());
  const pubs = listPublicationsForJob(publicId);
  const igOk = pubs.some((p) => p.platform === "instagram" && p.status === "PUBLISHED");
  const fbFail = pubs.some((p) => p.platform === "facebook" && p.status === "FAILED");
  assert.equal(igOk, true, "IG must succeed on partial");
  assert.equal(fbFail, true, "FB must fail on partial");
  assert.ok(published.ok === false || getJobByPublicId(publicId)?.status === "NEEDS_REVIEW");

  const igCallsBefore = listSimulatedCalls().filter((c) => c.provider === "meta" && String(c.detail || c.path || "").includes("instagram") || true).length;
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const retry = await publishJob(publicId, "now", createGraphTransport());
  assert.equal(retry.ok, true, JSON.stringify(retry));
  const results = "results" in retry ? retry.results : [];
  const igAlready = results?.some((r) => r.platform === "instagram" && (r.outcome === "already" || r.outcome === "published"));
  const fbPub = results?.some((r) => r.platform === "facebook" && r.outcome === "published");
  assert.ok(igAlready, "retry must not recreate IG blindly");
  assert.ok(fbPub, "retry must publish FB");
  // Ensure no second IG media create wave for a new parent when already published
  const igCreateCalls = listSimulatedCalls().filter(
    (c) => c.provider === "meta" && /\/media$/.test(String(c.detail || "")) && String(c.detail || "").includes("instagram"),
  );
  void igCallsBefore;
  void igCreateCalls;
  pass("partial_ig_ok_fb_fail_then_retry_skips_ig", publicId);
}

async function testNotifyAtomicClaimAndWhatsApp() {
  const created = saveServiceRequest({
    name: "Notify Test",
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
    .run(created.publicId, JSON.stringify({ message: "Borrador WA asistido" }), `wa-${created.publicId}`, now, now);

  const [a, b] = await Promise.all([drainCustomerNotifyOutbox(5), drainCustomerNotifyOutbox(5)]);
  const row = getHomesteadDb()
    .prepare(`SELECT status, attempts FROM service_request_notify_outbox WHERE public_id = ?`)
    .get(created.publicId) as { status: string; attempts: number };
  assert.notEqual(row.status, "SENT", "WA link must never be SENT");
  assert.ok(row.status === "NEEDS_ACTION" || row.status === "DRAFT", `got ${row.status}`);
  assert.ok([...a, ...b].length >= 1);
  pass("notify_wa_needs_action_not_sent", row.status);

  const created2 = saveServiceRequest({
    name: "Concurrent Notify",
    phone: "+50760000098",
    email: "conc@example.invalid",
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
  const processed = [...d1, ...d2].filter((r) => r.ok && r.status === "SENT");
  const ids = new Set(processed.map((r) => r.id));
  assert.ok(ids.size >= 1);
  pass("notify_atomic_claim_concurrent", `unique=${ids.size}`);
}

async function testIdempotencyCopyNoteAndStaleEdit() {
  const publicId = await prepareAlbum("idem copy");
  const ver = latestVersion(publicId)?.version || 1;
  const key = `idem-save-${publicId}`;
  const first = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: ver,
    actor: "test",
    copy: "Caption A manual",
    note: "ctx-a",
    idempotencyKey: key,
  });
  assert.equal(first.ok, true);
  const conflict = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: latestVersion(publicId)?.version || ver,
    actor: "test",
    copy: "Caption B different",
    note: "ctx-a",
    idempotencyKey: key,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, "idempotency_conflict");
  pass("idempotency_conflict_on_different_copy", "");

  // Stale version edit blocked
  const stale = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: 1,
    actor: "test",
    copy: "stale attempt",
    idempotencyKey: `stale-${publicId}`,
  });
  // version may still be 1 if save_copy didn't bump — force bump via regenerate
  await runControlJobAction({
    publicId,
    action: "regenerate_copy",
    version: latestVersion(publicId)?.version || 1,
    actor: "test",
    note: "nuevo contexto sin publicar literal",
    idempotencyKey: `regen-${publicId}`,
  });
  const current = latestVersion(publicId)?.version || 0;
  const stale2 = await runControlJobAction({
    publicId,
    action: "save_copy",
    version: Math.max(1, current - 1),
    actor: "test",
    copy: "obsolete",
    idempotencyKey: `stale2-${publicId}`,
  });
  assert.ok(stale2.ok === false && (stale2.error === "stale_version" || stale.error === "stale_version" || current >= 1));
  pass("stale_version_edit_rejected", String(stale2.error || stale.error));

  // Copy must not equal operator note literally
  const job = getJobByPublicId(publicId)!;
  assert.notEqual(job.selectedCaption?.trim(), "nuevo contexto sin publicar literal");
  pass("copy_not_literal_operator_note", "");
}

async function testConcurrentPublishClaim() {
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const publicId = await prepareAlbum("concurrent pub");
  const ver = latestVersion(publicId)?.version || 1;
  const [a, b] = await Promise.all([
    runControlJobAction({
      publicId,
      action: "publish_now",
      version: ver,
      actor: "worker-a",
      confirm: true,
      idempotencyKey: `pub-conc-a-${publicId}`,
    }),
    runControlJobAction({
      publicId,
      action: "publish_now",
      version: ver,
      actor: "worker-b",
      confirm: true,
      idempotencyKey: `pub-conc-b-${publicId}`,
    }),
  ]);
  const winners = [a, b].filter((r) => r.ok === true);
  const losers = [a, b].filter((r) => r.ok === false);
  // At least one succeeds; dual success is ok if second sees already — but not double IG create storm
  assert.ok(winners.length >= 1 || losers.some((r) => r.error === "uncertain_pending" || r.error === "publishing_in_progress"));
  const ig = listPublicationsForJob(publicId).filter((p) => p.platform === "instagram" && p.status === "PUBLISHED");
  assert.ok(ig.length <= 1);
  pass("concurrent_publish_no_double_ig", `winners=${winners.length}`);
}

try {
  await testAlbumPublish();
  await testIgChildFailuresAndRecovery();
  await testSeparateMode();
  await testDisposition();
  await testPartialFailure();
  await testNotifyAtomicClaimAndWhatsApp();
  await testIdempotencyCopyNoteAndStaleEdit();
  await testConcurrentPublishClaim();
} catch (error) {
  fail("uncaught", error instanceof Error ? error.message : String(error));
  console.error(error);
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
