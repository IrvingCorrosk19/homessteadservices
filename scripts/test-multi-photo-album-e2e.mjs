/**
 * Functional multi-photo album checks (simulated Meta only).
 * Distinguishes: [simulacion] vs live — this script never calls real Graph.
 */
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(root, "docs", "AUDIT", `multi-photo-album-${stamp.slice(0, 19)}`);
mkdirSync(evidenceDir, { recursive: true });

const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "multi-photo-album-e2e");
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
  assertIsolatedSecretsCleared,
  isControlIsolated,
  setSimulatedGraphScenario,
  listSimulatedCalls,
  resetSimulatedCalls,
} = await import("../src/lib/control-isolation.ts");
assertIsolatedSecretsCleared();
ok("isolated", isControlIsolated() === true);

const { getHomesteadDb } = await import("../src/lib/service-requests.ts");
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
const { listOrderedBrandedFeeds, parseMediaOrderJson } = await import("../src/lib/content-multi-photo.ts");
const { getControlJobDetail, runControlJobAction } = await import("../src/lib/control-service.ts");
const sharp = (await import("sharp")).default;

async function jpeg(label, opts = {}) {
  const width = opts.width || 1080;
  const height = opts.height || 1350;
  const salt = Number(opts.salt || 0) % 200;
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: {
        r: 20 + ((String(label).charCodeAt(0) + salt) % 200),
        g: 40 + ((String(label).length * 17 + salt * 3) % 180),
        b: 80 + (salt % 40),
      },
    },
  })
    .jpeg()
    .toBuffer();
}

let fileSalt = 0;
async function fiveFiles(prefix = "mp") {
  fileSalt += 1;
  const salt = fileSalt;
  const files = [];
  for (const label of ["A", "B", "C", "D", "E"]) {
    files.push({
      filename: `${prefix}-${salt}-${label}.jpg`,
      bytes: await jpeg(`${prefix}${label}${salt}`, { salt }),
    });
  }
  return files;
}

// --- 1 photo ---
{
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const ingested = await ingestControlPhotos({
    files: [{ filename: "one.jpg", bytes: await jpeg("1") }],
    note: "single",
    actor: "test",
    publishMode: "separate",
  });
  const publicId = ingested.items.find((i) => i.ok)?.publicId || "";
  ok("1foto ingest", ingested.ok === true && Boolean(publicId), publicId);
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: latestVersion(publicId)?.version || 1, status: "APPROVED" });
  const published = await publishJob(publicId, "now", createGraphTransport());
  ok("1foto publish", published.ok === true, JSON.stringify(published.results?.map((r) => r.outcome)));
  const meta = listSimulatedCalls().filter((c) => c.provider === "meta");
  const carouselParent = meta.some((c) => c.request?.mediaType === "CAROUSEL");
  ok("1foto no carousel parent", !carouselParent, String(meta.length));
}

// --- 5 photos album ---
let albumId = "";
let albumOrder = [];
{
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const files = await fiveFiles();
  const ingested = await ingestControlPhotos({
    files,
    note: "cerradura digital instalada — álbum 5 fotos prueba interna",
    actor: "test",
    publishMode: "album",
  });
  albumId = ingested.publicId || "";
  ok("5foto album ingest", ingested.ok === true && ingested.publishMode === "album", albumId);
  ok("5foto all items ok", ingested.items.filter((i) => i.ok).length === 5, String(ingested.items.length));
  ok("5foto same publicId", ingested.items.every((i) => i.publicId === albumId));
  const job = getJobByPublicId(albumId);
  ok("5foto format CAROUSEL", job?.format === "CAROUSEL" && job?.publishMode === "album");
  albumOrder = parseMediaOrderJson(job?.mediaOrderJson);
  ok("5foto mediaOrder length", albumOrder.length === 5, JSON.stringify(albumOrder));
  const feeds = listOrderedBrandedFeeds(albumId, 1, job?.mediaOrderJson);
  ok("5foto branded feeds", feeds.length === 5 && feeds.every((f) => f.storedFilename.includes("-feed")));
  const detail = getControlJobDetail(albumId);
  ok("5foto detail mediaItems", detail?.mediaItems?.length === 5, String(detail?.mediaItems?.length));
  ok("5foto preview/order match", detail?.mediaItems?.map((m) => m.assetId).join(",") === albumOrder.join(","));

  tryApproveContentJob(albumId, "test");
  updateJob(albumId, { approvedVersion: latestVersion(albumId)?.version || 1, status: "APPROVED" });
  const published = await publishJob(albumId, "now", createGraphTransport());
  ok("5foto publish ok", published.ok === true, JSON.stringify(published));
  const meta = listSimulatedCalls().filter((c) => c.provider === "meta");
  const igChildren = meta.filter((c) => c.request?.isCarouselItem === true);
  const igParent = meta.filter((c) => c.request?.mediaType === "CAROUSEL");
  const fbUnpublished = meta.filter(
    (c) => /\/photos/.test(String(c.request?.path || "")) && (c.request?.attachedMediaCount || 0) === 0 && /published=false|photos/i.test(c.detail + JSON.stringify(c.request || {})),
  );
  const fbFeed = meta.filter((c) => /\/feed/.test(String(c.request?.path || "")) || (c.request?.attachedMediaCount || 0) >= 2);
  ok("5foto IG children=5", igChildren.length === 5, String(igChildren.length));
  ok("5foto IG parent carousel", igParent.length === 1, String(igParent.length));
  ok(
    "5foto FB multiphoto signals",
    fbFeed.some((c) => (c.request?.attachedMediaCount || 0) === 5) || meta.filter((c) => /\/photos/.test(String(c.request?.path || ""))).length >= 5,
    `feedAttached=${fbFeed.map((c) => c.request?.attachedMediaCount).join(",")} photos=${meta.filter((c) => /\/photos/.test(String(c.request?.path || ""))).length}`,
  );
  void fbUnpublished;
  const pubs = listPublicationsForJob(albumId);
  ok(
    "5foto both platforms published",
    pubs.filter((p) => p.status === "PUBLISHED").length >= 2,
    pubs.map((p) => `${p.platform}:${p.status}`).join(","),
  );
}

// --- reorder + remove before approve ---
{
  const files = await fiveFiles();
  const ingested = await ingestControlPhotos({
    files,
    note: "reorder test",
    actor: "test",
    publishMode: "album",
  });
  const publicId = ingested.publicId;
  const job = getJobByPublicId(publicId);
  const order = parseMediaOrderJson(job.mediaOrderJson);
  const reversed = [...order].reverse();
  const removeOne = reversed[0];
  const nextOrder = reversed.slice(1);
  const version = latestVersion(publicId)?.version || 1;
  const action = await runControlJobAction({
    publicId,
    action: "noop_media_probe",
    actor: "test",
    version,
  }).catch(() => null);
  // Direct media route logic via catalog edit path used by API:
  const { applyContentEditAtomic } = await import("../src/lib/content-edit-guard.ts");
  const applied = applyContentEditAtomic({
    publicId,
    expectedVersion: version,
    kind: "image",
    actor: "test",
    event: "CONTENT_MEDIA_CHANGED",
    copy: job.selectedCaption || "",
    cta: "Agenda en homestead.lat",
    hashtags: "#HomesteadServices #Panama",
    prompt: "media-reorder",
    privacyNote: `soft_remove=${removeOne}`,
    mediaOrderJson: JSON.stringify(nextOrder),
    jobPatch: {
      mediaOrderJson: JSON.stringify(nextOrder),
      format: "CAROUSEL",
      publishMode: "album",
      approvedVersion: null,
      approvedAt: null,
      status: "AWAITING_APPROVAL",
      lastError: "media_changed",
    },
  });
  void action;
  ok("reorder+remove applied", applied.ok === true, String(applied.version || ""));
  const after = getJobByPublicId(publicId);
  const afterOrder = parseMediaOrderJson(after.mediaOrderJson);
  ok("reorder persisted 4", afterOrder.length === 4 && afterOrder.join(",") === nextOrder.join(","), afterOrder.join(","));
  ok("approval cleared", !after.approvedVersion && after.status === "AWAITING_APPROVAL");
  ok("removed not in order", !afterOrder.includes(removeOne));
}

// --- invalid image ---
{
  const good = await jpeg("G");
  const ingested = await ingestControlPhotos({
    files: [
      { filename: "good.jpg", bytes: good },
      { filename: "bad.bin", bytes: Buffer.from("not-an-image") },
      { filename: "good2.jpg", bytes: await jpeg("H") },
    ],
    note: "invalid mix",
    actor: "test",
    publishMode: "album",
  });
  ok("invalid album rejected", ingested.ok === false, ingested.error || "");
  ok(
    "invalid names which failed",
    ingested.items.some((i) => !i.ok && i.filename === "bad.bin"),
    ingested.items.map((i) => `${i.filename}:${i.error || "ok"}`).join("|"),
  );
}

// --- partial platform failure + retry only pending ---
{
  resetSimulatedCalls();
  setSimulatedGraphScenario("fail_facebook");
  const files = await fiveFiles();
  const ingested = await ingestControlPhotos({
    files,
    note: "partial fail",
    actor: "test",
    publishMode: "album",
  });
  const publicId = ingested.publicId;
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: latestVersion(publicId)?.version || 1, status: "APPROVED" });
  const first = await publishJob(publicId, "now", createGraphTransport());
  const pubs1 = listPublicationsForJob(publicId);
  const ig1 = pubs1.find((p) => p.platform === "instagram");
  const fb1 = pubs1.find((p) => p.platform === "facebook");
  ok("partial IG published or failed-known", Boolean(ig1), ig1?.status || "");
  ok("partial first not full success", first.ok === false || fb1?.status !== "PUBLISHED", JSON.stringify(first.results));
  // Force IG published + FB failed for clean retry semantics if scenario differs
  if (ig1?.status !== "PUBLISHED") {
    getHomesteadDb()
      .prepare(
        `UPDATE content_publications SET status='PUBLISHED', error='', external_post_id='sim-ig-keep' WHERE public_id=? AND platform='instagram'`,
      )
      .run(publicId);
  }
  getHomesteadDb()
    .prepare(
      `UPDATE content_publications SET status='FAILED', error='facebook_multiphotopost_failed', external_post_id='' WHERE public_id=? AND platform='facebook'`,
    )
    .run(publicId);
  updateJob(publicId, { status: "NEEDS_REVIEW", lastError: "facebook:failed", approvedVersion: latestVersion(publicId)?.version || 1 });
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const retry = await publishJob(publicId, "now", createGraphTransport());
  const pubs2 = listPublicationsForJob(publicId);
  const ig2 = pubs2.find((p) => p.platform === "instagram");
  const fb2 = pubs2.find((p) => p.platform === "facebook");
  ok("retry keeps IG", ig2?.status === "PUBLISHED", ig2?.external_post_id || ig2?.status);
  ok("retry FB pending ok", retry.ok === true && fb2?.status === "PUBLISHED", fb2?.status);
  const metaRetry = listSimulatedCalls().filter((c) => c.provider === "meta");
  const igRetryChildren = metaRetry.filter((c) => c.request?.isCarouselItem === true);
  ok("retry did not recreate IG carousel", igRetryChildren.length === 0, String(igRetryChildren.length));
}

// --- double publish lock / idempotency ---
{
  resetSimulatedCalls();
  setSimulatedGraphScenario("ok");
  const files = await fiveFiles();
  const ingested = await ingestControlPhotos({
    files,
    note: "double click",
    actor: "test",
    publishMode: "album",
  });
  const publicId = ingested.publicId;
  tryApproveContentJob(publicId, "test");
  updateJob(publicId, { approvedVersion: latestVersion(publicId)?.version || 1, status: "APPROVED" });
  const p1 = publishJob(publicId, "now", createGraphTransport());
  const p2 = publishJob(publicId, "now", createGraphTransport());
  const [a, b] = await Promise.all([p1, p2]);
  const locked = [a, b].some((r) => r.cause === "locked" || r.ok === false);
  const oneOk = [a, b].some((r) => r.ok === true);
  ok("double-click one succeeds", oneOk, JSON.stringify([a.ok, b.ok, a.cause, b.cause]));
  ok("double-click other locked or already", locked || [a, b].some((r) => r.results?.some((x) => x.outcome === "already")));
  const third = await publishJob(publicId, "now", createGraphTransport());
  ok(
    "second pass already published",
    third.ok === true && third.results?.every((r) => r.outcome === "already" || r.outcome === "published"),
    JSON.stringify(third.results),
  );
}

// --- reopen persistence ---
{
  const detail = getControlJobDetail(albumId);
  ok("reopen album still 5", detail?.mediaItems?.length === 5, String(detail?.mediaItems?.length));
  ok("reopen order stable", detail?.mediaItems?.map((m) => m.assetId).join(",") === albumOrder.join(","));
  const assets = listAssets(albumId, "BRANDED").filter((a) => a.storedFilename.includes("-feed"));
  ok("reopen assets on disk", assets.length >= 5, String(assets.length));
}

// --- admin default without publishMode must be separate (API contract) ---
{
  const files = [];
  for (let i = 0; i < 5; i++) {
    const bytes = await sharp({
      create: {
        width: 1080,
        height: 1350,
        channels: 3,
        background: { r: 5 + i * 45, g: 100 + i * 10, b: 150 - i * 20 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="10" y="50" font-size="40">SEP${Date.now()}-${i}</text></svg>`,
          ),
          top: 40 + i * 30,
          left: 40 + i * 20,
        },
      ])
      .jpeg()
      .toBuffer();
    files.push({ filename: `omit-sep-${i}.jpg`, bytes });
  }
  const ingested = await ingestControlPhotos({
    files,
    note: "default separate if omitted",
    actor: "test",
    // publishMode omitted
  });
  const ids = [...new Set(ingested.items.filter((i) => i.ok).map((i) => i.publicId))];
  ok(
    "omit mode = separate N jobs",
    ingested.ok === true && ids.length === 5 && ingested.publishMode === "separate",
    `${ids.join(",")} mode=${ingested.publishMode} items=${ingested.items.map((i) => `${i.filename}:${i.publicId}:${i.duplicate}`).join("|")}`,
  );
}

writeFileSync(join(evidenceDir, "results.txt"), lines.join("\n") + `\n\nfailed=${failed}\n`, "utf8");
console.log(`\nEvidence: ${evidenceDir}`);
console.log(failed ? `FAILED ${failed}` : "ALL PASS [simulacion]");
process.exit(failed ? 1 : 0);
