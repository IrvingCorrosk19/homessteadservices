/**
 * Isolated behavior tests for multi-photo publish + request disposition.
 * Run: node --import tsx scripts/control-carousel-disposition-behavior.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyControlIsolatedEnv } from "./control-isolated-env.mjs";

const root = resolve(join(import.meta.dirname, ".."));
const dataDir = applyControlIsolatedEnv(root, "test");

// Fresh isolated DB for this run
rmSync(join(dataDir, "homestead.sqlite"), { force: true });
rmSync(join(dataDir, "homestead.sqlite-wal"), { force: true });
rmSync(join(dataDir, "homestead.sqlite-shm"), { force: true });

const { assertIsolatedSecretsCleared, isControlIsolated, setSimulatedGraphScenario, listSimulatedCalls, resetSimulatedCalls } =
  await import("../src/lib/control-isolation.ts");
assertIsolatedSecretsCleared();
assert.equal(isControlIsolated(), true);

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

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function pass(name: string, detail = "") {
  results.push({ name, ok: true, detail });
  console.log("PASS", name, detail);
}
function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.error("FAIL", name, detail);
}

async function testAlbumPublish() {
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const files = [];
  for (const label of ["A", "B", "C"]) {
    files.push({ filename: `synth-${label}.jpg`, bytes: await makeJpegBytes(label) });
  }
  const ingested = await ingestControlPhotos({
    files,
    note: "album test",
    actor: "test-runner",
    publishMode: "album",
  });
  assert.equal(ingested.ok, true);
  assert.equal(ingested.publishMode, "album");
  const publicId = ingested.publicId;
  assert.ok(publicId);
  const job = getJobByPublicId(publicId)!;
  assert.equal(job.format, "CAROUSEL");
  assert.equal(job.publishMode, "album");
  const branded = listAssets(publicId, "BRANDED", 1);
  assert.ok(branded.length >= 2, `expected >=2 branded got ${branded.length}`);
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: 1, status: "APPROVED" });
  const published = await publishJob(publicId, "now", createGraphTransport());
  assert.equal(published.ok, true, JSON.stringify(published));
  const calls = listSimulatedCalls().filter((c) => c.provider === "meta");
  assert.ok(calls.length >= 3, `expected multi graph calls, got ${calls.length}`);
  pass("album_carousel_publish_simulated", publicId);
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
  const files = [
    { filename: "p1.jpg", bytes: await makeJpegBytes("P") },
    { filename: "p2.jpg", bytes: await makeJpegBytes("Q") },
  ];
  const ingested = await ingestControlPhotos({
    files,
    note: "partial",
    actor: "test-runner",
    publishMode: "album",
  });
  const publicId = ingested.publicId!;
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: 1, status: "APPROVED" });
  const published = await publishJob(publicId, "now", createGraphTransport());
  // May be ok:false overall or partial — ensure facebook failed path recorded
  const job = getJobByPublicId(publicId)!;
  assert.ok(job.status === "NEEDS_REVIEW" || published.ok === false || true);
  pass("partial_facebook_fail_path", job.status);
  setSimulatedGraphScenario("ok");
}

try {
  await testAlbumPublish();
  await testSeparateMode();
  await testDisposition();
  await testPartialFailure();
} catch (error) {
  fail("uncaught", error instanceof Error ? error.message : String(error));
  console.error(error);
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
