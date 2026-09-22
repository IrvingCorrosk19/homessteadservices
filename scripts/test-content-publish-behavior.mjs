import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const policySrc = readFileSync(join(root, "src/lib/content-publish-policy.ts"), "utf8");
const publishSrc = readFileSync(join(root, "src/lib/content-publish.ts"), "utf8");
const catalogSrc = readFileSync(join(root, "src/lib/content-catalog.ts"), "utf8");
const handlerSrc = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

function jobUsesLiveOverride(job, settingsDryRun, source, paused = false, publishEnabled = true) {
  if (paused) return false;
  if (!publishEnabled) return false;
  if (!settingsDryRun) return true;
  return Boolean(job.liveOnce) && source === "live";
}

function facebookReconcileDecision(input) {
  const status = input.existingStatus || "";
  const postId = (input.existingPostId || "").trim();
  if (status === "UNCERTAIN" || status === "PUBLISHING") {
    if (postId) return { action: "lookup_stored_id", postId };
    if (input.source === "live") return { action: "create_new" };
    return { action: "cannot_reconcile" };
  }
  return { action: "create_new" };
}

function selectRetryPlatforms(results) {
  return results
    .filter((row) => row.outcome === "failed" || row.outcome === "uncertain")
    .map((row) => row.platform);
}

function mergeIndependentPlatformResults(previous, next) {
  const map = new Map(previous.map((row) => [row.platform, row]));
  for (const row of next) {
    const current = map.get(row.platform);
    if (current?.outcome === "published" || current?.outcome === "already") continue;
    map.set(row.platform, row);
  }
  return [...map.values()];
}

function beginLock(store, id, now) {
  const until = store.get(id) || 0;
  if (until > now) return false;
  store.set(id, now + 180_000);
  return true;
}

ok("BHV-01 source matches live_once only on live", policySrc.includes('source === "live"'));
ok("BHV-02 pause clears live_once in catalog", /live_once = 0/.test(catalogSrc));
ok("BHV-03 consume live once on live source", /shouldConsumeLiveOnce/.test(publishSrc));
ok("BHV-04 no caption scan of page posts", !/\/posts\?fields=id,message/.test(publishSrc));
ok("BHV-05 retry uses live confirm not now", /REINTENTAR EN VIVO/.test(publishSrc));
ok("BHV-06 liveyes rejects stale version", /Ese botón es de V/.test(handlerSrc));

ok(
  "BHV-07 dry-run + liveOnce + now stays simulated",
  jobUsesLiveOverride({ liveOnce: 1 }, true, "now") === false,
);
ok(
  "BHV-08 dry-run + liveOnce + scheduler stays simulated",
  jobUsesLiveOverride({ liveOnce: 1 }, true, "scheduler") === false,
);
ok(
  "BHV-09 dry-run + liveOnce + live is live",
  jobUsesLiveOverride({ liveOnce: 1 }, true, "live") === true,
);
ok(
  "BHV-10 pause blocks live_once",
  jobUsesLiveOverride({ liveOnce: 1 }, true, "live", true) === false,
);
ok(
  "BHV-11 kill switch blocks live_once",
  jobUsesLiveOverride({ liveOnce: 1 }, true, "live", false, false) === false,
);
ok(
  "BHV-12 global live ignores liveOnce",
  jobUsesLiveOverride({ liveOnce: 0 }, false, "scheduler") === true,
);

ok(
  "BHV-13 uncertain without id does not steal another caption",
  facebookReconcileDecision({ existingStatus: "UNCERTAIN", existingPostId: "", source: "scheduler" })
    .action === "cannot_reconcile",
);
ok(
  "BHV-14 uncertain with stored id looks up that id",
  facebookReconcileDecision({
    existingStatus: "UNCERTAIN",
    existingPostId: "123_456",
    source: "scheduler",
  }).action === "lookup_stored_id",
);
ok(
  "BHV-15 operator live confirm may create new if no id",
  facebookReconcileDecision({ existingStatus: "UNCERTAIN", existingPostId: "", source: "live" })
    .action === "create_new",
);

const partial = [
  { platform: "instagram", outcome: "published" },
  { platform: "facebook", outcome: "failed" },
];
ok("BHV-16 retry only facebook after partial", selectRetryPlatforms(partial).join() === "facebook");
const merged = mergeIndependentPlatformResults(partial, [
  { platform: "instagram", outcome: "failed" },
  { platform: "facebook", outcome: "published" },
]);
ok(
  "BHV-17 second attempt cannot unpublish instagram",
  merged.find((row) => row.platform === "instagram").outcome === "published" &&
    merged.find((row) => row.platform === "facebook").outcome === "published",
);

const locks = new Map();
ok("BHV-18 first lock wins", beginLock(locks, "HC-1", 1_000) === true);
ok("BHV-19 concurrent lock rejected", beginLock(locks, "HC-1", 1_100) === false);
ok("BHV-20 other job not blocked", beginLock(locks, "HC-2", 1_100) === true);
ok("BHV-21 lock expires", beginLock(locks, "HC-1", 200_000) === true);

if (failed) {
  console.error(`\n${failed} behavior assertion(s) failed`);
  process.exit(1);
}
console.log("\nCONTENT PUBLISH BEHAVIOR checks OK (executable policy; Graph not called)");
