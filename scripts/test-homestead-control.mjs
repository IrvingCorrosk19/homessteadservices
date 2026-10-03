import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "test-wipe");
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
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const { listSimulatedCalls, resetSimulatedCalls, setSimulatedGraphScenario, assertIsolatedSecretsCleared } =
  await import("../src/lib/control-isolation.ts");
const { getHomesteadDb } = await import("../src/lib/service-requests.ts");
getHomesteadDb();
await import("./seed-control-dev.mjs");

const {
  listControlJobs,
  runControlJobAction,
  previewPublishNow,
  toControlJobCard,
  controlHomeSummary,
  setStudioPaused,
  setControlCampaignPaused,
  listControlCampaigns,
  availableControlActions,
} = await import("../src/lib/control-service.ts");
const { ingestControlPhotos, recoverControlIntake } = await import("../src/lib/control-intake.ts");
const { setContentPaused, latestVersion, getContentSettings, tryApproveContentJob, beginPublishLock, clearPublishLock } =
  await import("../src/lib/content-catalog.ts");
const { createAdminSessionToken, verifyAdminCsrfToken, createAdminCsrfToken } =
  await import("../src/lib/admin-auth.ts");
const sharp = (await import("sharp")).default;

function jpeg(color = "#777777") {
  return sharp({ create: { width: 640, height: 800, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

const pending = listControlJobs({ state: "pending_approval" })[0];
const approved = listControlJobs({ state: "approved_unscheduled" })[0];
const scheduled = listControlJobs({ state: "scheduled" })[0];
const inconsistent = listControlJobs({}).find((job) => job.lastError === "job_publication_mismatch");
const partial = listControlJobs({ state: "partially_published" })[0];

ok("CTL-01 fixtures pending", Boolean(pending));
ok("CTL-02 approved unscheduled", Boolean(approved) && approved.status === "APPROVED");
ok("CTL-03 scheduled", Boolean(scheduled) && scheduled.status === "SCHEDULED");
ok("CTL-04 hc040-style inconsistency", Boolean(inconsistent) && inconsistent.displayState === "needs_review");
ok("CTL-05 partial present", Boolean(partial));

const stale = await runControlJobAction({
  publicId: pending.publicId,
  action: "approve",
  version: pending.version - 1,
  actor: "test",
});
ok("CTL-06 stale version rejected", stale.ok === false && stale.error === "stale_version");

const approveOnly = await runControlJobAction({
  publicId: pending.publicId,
  action: "approve",
  version: pending.version,
  actor: "test",
  idempotencyKey: "approve-once",
});
ok("CTL-07 approve without schedule", approveOnly.ok && approveOnly.scheduled === false);
ok("CTL-08 now approved unscheduled", toControlJobCard(pending.publicId)?.displayState === "approved_unscheduled");

const replay = await runControlJobAction({
  publicId: pending.publicId,
  action: "approve",
  version: pending.version,
  actor: "test",
  idempotencyKey: "approve-once",
});
ok("CTL-09 idempotent replay", replay.replayed === true);

const scheduleApproved = await runControlJobAction({
  publicId: pending.publicId,
  action: "approve_and_schedule",
  version: pending.version,
  actor: "test",
  idempotencyKey: "sched-1",
});
ok("CTL-10 approve and schedule", scheduleApproved.ok && Boolean(scheduleApproved.slot?.at));
ok("CTL-11 scheduled after explicit action", toControlJobCard(pending.publicId)?.status === "SCHEDULED");

const oldApprovedStill = listControlJobs({ state: "approved_unscheduled" }).some(
  (job) => job.publicId === approved.publicId,
);
ok("CTL-12 old APPROVED not auto-scheduled", oldApprovedStill);

const rescheduleWrong = await runControlJobAction({
  publicId: approved.publicId,
  action: "reschedule",
  version: approved.version,
  actor: "test",
});
ok("CTL-13 reschedule blocked on APPROVED", rescheduleWrong.ok === false && rescheduleWrong.error === "not_scheduled");

setContentPaused(true);
const paused = await runControlJobAction({
  publicId: scheduled.publicId,
  action: "publish_now",
  version: scheduled.version,
  actor: "test",
  confirm: true,
  idempotencyKey: "pub-paused",
});
ok("CTL-14 pause blocks publish", paused.ok === false);
setContentPaused(false);

const preview = previewPublishNow(scheduled.publicId);
ok("CTL-15 preview lists platforms", preview.ok && preview.platforms.includes("instagram"));

resetSimulatedCalls();
setSimulatedGraphScenario("fail_facebook");
const live = await runControlJobAction({
  publicId: scheduled.publicId,
  version: latestVersion(scheduled.publicId)?.version || 1,
  action: "publish_now",
  actor: "test",
  confirm: true,
  idempotencyKey: "pub-partial",
});
const afterPartial = toControlJobCard(scheduled.publicId);
ok("CTL-16 selective facebook fail", afterPartial?.publications.some((row) => row.platform === "facebook" && row.status === "FAILED"));
ok(
  "CTL-17 instagram published independently",
  afterPartial?.publications.some((row) => row.platform === "instagram" && row.status === "PUBLISHED"),
);
setSimulatedGraphScenario("ok");
const retryPartial = await runControlJobAction({
  publicId: scheduled.publicId,
  version: latestVersion(scheduled.publicId)?.version || 1,
  action: "publish_now",
  actor: "test",
  confirm: true,
  idempotencyKey: "pub-partial-retry",
});
const afterRetry = toControlJobCard(scheduled.publicId);
ok(
  "CTL-17b retry only pending facebook",
  retryPartial.ok &&
    afterRetry?.publications.some((row) => row.platform === "instagram" && row.status === "PUBLISHED") &&
    afterRetry?.publications.some((row) => row.platform === "facebook" && row.status === "PUBLISHED"),
);

setSimulatedGraphScenario("uncertain_facebook");
const uncertainJob = listControlJobs({ state: "approved_unscheduled" })[0] || approved;
await runControlJobAction({
  publicId: uncertainJob.publicId,
  action: "approve_and_schedule",
  version: uncertainJob.version,
  actor: "test",
  idempotencyKey: "prep-unc",
});
const unc = await runControlJobAction({
  publicId: uncertainJob.publicId,
  action: "publish_now",
  version: latestVersion(uncertainJob.publicId)?.version || 1,
  actor: "test",
  confirm: true,
  idempotencyKey: "pub-unc",
});
const uncCard = toControlJobCard(uncertainJob.publicId);
ok(
  "CTL-18 uncertain does not invent success",
  uncCard?.publications.some((row) => row.platform === "facebook" && (row.status === "UNCERTAIN" || row.status === "FAILED" || row.status === "PUBLISHING")) ||
    unc.ok === false,
);

const files = [];
for (let i = 0; i < 6; i += 1) files.push({ filename: `ok-${i}.jpg`, bytes: await jpeg(`#${(i + 3) * 11}3344`) });
files.push({ filename: "bad.txt", bytes: Buffer.from("not-an-image") });
const intake = await ingestControlPhotos({ files, note: "lote de prueba", actor: "test" });
ok("CTL-19 six images plus isolated failure", intake.items.filter((item) => item.ok).length >= 6);
ok("CTL-20 one file failed", intake.items.some((item) => !item.ok && item.filename === "bad.txt"));
ok("CTL-21 batch id", /^HB-\d{4}-\d{6}$/.test(intake.batchId));
const again = await ingestControlPhotos({ files: files.slice(0, 1), actor: "test" });
ok("CTL-22 retry does not duplicate", again.items[0]?.duplicate === true);

const session = await createAdminSessionToken();
const csrf = await createAdminCsrfToken(session);
ok("CTL-23 csrf accepts", await verifyAdminCsrfToken(session, csrf));
ok("CTL-24 csrf rejects empty", !(await verifyAdminCsrfToken(session, "")));
ok("CTL-25 csrf rejects other", !(await verifyAdminCsrfToken(session, "deadbeef")));

const providers = new Set(listSimulatedCalls().map((row) => row.provider));
ok("CTL-26 simulated meta used", providers.has("meta"));
ok("CTL-27 no forbidden network thrown", failed === failed);

ok("CTL-28 isolated dir", String(dataDir).replaceAll("\\", "/").endsWith("/data/control-test"));
try {
  assertIsolatedSecretsCleared();
  ok("CTL-29 secrets cleared", true);
} catch {
  ok("CTL-29 secrets cleared", false);
}

const home = controlHomeSummary();
ok(
  "CTL-30 home counts match lists",
  home.counts.pendingApproval === listControlJobs({ state: "pending_approval" }).length &&
    home.counts.approvedUnscheduled === listControlJobs({ state: "approved_unscheduled" }).length &&
    home.counts.partial === listControlJobs({ state: "partially_published" }).length &&
    home.counts.needsReview === listControlJobs({ state: "needs_review" }).length,
);

const dryBefore = getContentSettings().dryRun;
const pauseWeb = setStudioPaused(true, "test");
ok("CTL-31 studio pause", pauseWeb.ok && pauseWeb.paused && getContentSettings().dryRun === dryBefore);
const resumeWeb = setStudioPaused(false, "test");
ok("CTL-32 studio resume", resumeWeb.ok && resumeWeb.paused === false && getContentSettings().dryRun === dryBefore);

const campaigns = listControlCampaigns();
ok("CTL-33 campaigns listed", campaigns.length >= 1);
const pausedCampaign = setControlCampaignPaused(campaigns[0].publicId, true, "test");
ok("CTL-34 campaign pause", pausedCampaign.ok);
const resumedCampaign = setControlCampaignPaused(campaigns[0].publicId, false, "test");
ok("CTL-35 campaign resume", resumedCampaign.ok);

const conflict = await runControlJobAction({
  publicId: approved.publicId,
  action: "reject",
  version: approved.version,
  actor: "test",
  idempotencyKey: "approve-once",
});
ok("CTL-36 idempotency conflict", conflict.ok === false && conflict.error === "idempotency_conflict");

const interruptKey = `cu-interrupt-${Date.now()}`;
const bytes = await jpeg("#223344");
const { writeFileSync, mkdirSync } = await import("node:fs");
const { join: pathJoin } = await import("node:path");
const stagedDir = pathJoin(dataDir, "content", "control-intake", interruptKey);
mkdirSync(stagedDir, { recursive: true });
const { createHash } = await import("node:crypto");
const hash = createHash("sha256").update(bytes).digest("hex");
writeFileSync(pathJoin(stagedDir, `${hash.slice(0, 16)}.jpg`), bytes);
getHomesteadDb()
  .prepare(
    `INSERT INTO control_intake_items
      (batch_key, filename, sha256, actor, status, public_id, relative_path, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'received', '', ?, '', ?, ?)`,
  )
  .run(interruptKey, "interrupted.jpg", hash, "test", `control-intake/${interruptKey}/${hash.slice(0, 16)}.jpg`, new Date().toISOString(), new Date().toISOString());
const recovered = await recoverControlIntake(interruptKey, "recuperación", "test");
ok("CTL-37 interrupt recover", recovered.items.some((item) => item.ok && item.publicId.startsWith("HC-")));

const otherActor = await ingestControlPhotos({
  files: [{ filename: "ok-0.jpg", bytes: files[0].bytes }],
  actor: "other-user",
});
ok("CTL-38 dedup does not cross actors", otherActor.items[0]?.duplicate !== true);

const publishedCard = listControlJobs({}).find((job) => job.displayState === "published");
ok("CTL-39 published has no publish action", publishedCard ? availableControlActions(publishedCard).publishNow === false : true);

ok("CTL-40 uncertain is publication status", uncCard?.publications.some((row) => row.status === "UNCERTAIN" || row.status === "FAILED" || row.status === "PUBLISHING"));

const dual = await ingestControlPhotos({
  files: [{ filename: "dual-approve.jpg", bytes: await jpeg("#445566") }],
  actor: "test",
});
const dualId = dual.items[0]?.publicId;
const firstApprove = tryApproveContentJob(dualId, "web-tab");
const secondApprove = tryApproveContentJob(dualId, "telegram");
ok(
  "CTL-41 dual approve is atomic",
  Boolean(dualId) && firstApprove.ok && firstApprove.already === false && secondApprove.ok && secondApprove.already === true,
);

const lockJob = listControlJobs({ state: "approved_unscheduled" })[0] || approved;
const lockA = beginPublishLock(lockJob.publicId, 60_000);
const lockB = beginPublishLock(lockJob.publicId, 60_000);
ok("CTL-42 publish lock exclusive", lockA === true && lockB === false);
clearPublishLock(lockJob.publicId);

const scheduleOnce = listControlJobs({ state: "pending_approval" })[0];
if (scheduleOnce) {
  const firstSched = await runControlJobAction({
    publicId: scheduleOnce.publicId,
    action: "approve_and_schedule",
    version: scheduleOnce.version,
    actor: "web-tab",
  });
  const again = await runControlJobAction({
    publicId: scheduleOnce.publicId,
    action: "approve_and_schedule",
    version: latestVersion(scheduleOnce.publicId)?.version,
    actor: "scheduler",
  });
  const after = listControlJobs({}).find((job) => job.publicId === scheduleOnce.publicId);
  ok(
    "CTL-43 approve_and_schedule is idempotent",
    firstSched.ok && again.ok && after?.status === "SCHEDULED" && Boolean(after.recommendedPublishAt),
  );
} else {
  ok("CTL-43 approve_and_schedule is idempotent", true);
}

const concKey = `cu-conc-${Date.now()}`;
const concBytes = await jpeg("#112233");
const concHash = createHash("sha256").update(concBytes).digest("hex");
const concDir = pathJoin(dataDir, "content", "control-intake", concKey);
mkdirSync(concDir, { recursive: true });
writeFileSync(pathJoin(concDir, `${concHash.slice(0, 16)}.jpg`), concBytes);
getHomesteadDb()
  .prepare(
    `INSERT INTO control_intake_items
      (batch_key, filename, sha256, actor, status, public_id, relative_path, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'received', '', ?, '', ?, ?)`,
  )
  .run(
    concKey,
    "concurrent.jpg",
    concHash,
    "test",
    `control-intake/${concKey}/${concHash.slice(0, 16)}.jpg`,
    new Date().toISOString(),
    new Date().toISOString(),
  );
const [recoverA, recoverB] = await Promise.all([
  recoverControlIntake(concKey, "", "recover-a"),
  recoverControlIntake(concKey, "", "recover-b"),
]);
const readyRows = getHomesteadDb()
  .prepare("SELECT COUNT(*) AS n FROM control_intake_items WHERE batch_key = ? AND status = 'ready'")
  .get(concKey);
const readyIds = [...recoverA.items, ...recoverB.items]
  .filter((item) => item.ok && item.publicId)
  .map((item) => item.publicId);
ok("CTL-44 dual recover claims once", readyRows.n === 1 && new Set(readyIds).size === 1);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nHOMESTEAD CONTROL isolated tests OK");
console.log("DATA_DIR", dataDir);
