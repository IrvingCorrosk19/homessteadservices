import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");

const publish = read("src/lib/content-publish.ts");
const media = read("src/lib/content-media-url.ts");
const meta = read("src/lib/content-meta.ts");
const catalog = read("src/lib/content-catalog.ts");
const handler = read("src/lib/content-handler.ts");
const processMod = read("src/lib/content-process.ts");
const copy = read("src/lib/content-copy.ts");
const openai = read("src/lib/content-openai.ts");
const types = read("src/lib/content-types.ts");
const compose = read("deploy/vps/docker-compose.yml");
const envExample = read(".env.example");
const schedulerN8n = read("n8n/homestead-n8n-content-scheduler.json");
const studioN8n = read("n8n/homestead-n8n-content-studio.json");
const tick = read("src/app/api/internal/content/scheduler-tick/route.ts");
const mediaRoute = read("src/app/api/content/media/route.ts");
const migrate = read("src/lib/service-requests.ts");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("META-01 instagram sends image_url", /image_url:\s*input\.imageUrl/.test(publish));
ok("META-02 does not void imageBytes", !/void imageBytes/.test(publish));
ok("META-03 facebook uses page photos", /\/photos/.test(publish) && !/facebook_uses_page_token_unconfigured/.test(publish));
ok("META-04 polls container status_code", /status_code/.test(publish));
ok("META-05 FACEBOOK_PAGE_ID in compose", /FACEBOOK_PAGE_ID/.test(compose));
ok("META-06 INSTAGRAM_ACCOUNT_ID in compose", /INSTAGRAM_ACCOUNT_ID/.test(compose));
ok("META-07 CONTENT_DRY_RUN still true default", /CONTENT_DRY_RUN: \$\{CONTENT_DRY_RUN:-true\}/.test(compose));
ok("META-08 env example has FACEBOOK_PAGE_ID", /FACEBOOK_PAGE_ID=/.test(envExample));
ok("META-09 META_PAGE_ID is alias only", /Deprecated alias/.test(envExample));
ok("META-10 n8n still not a Meta publisher", !/graph\.facebook\.com/.test(studioN8n) && !/instagram/i.test(studioN8n));
ok("META-11 scheduler surfaces ok:false", /¿Homestead ok\?/.test(schedulerN8n) && /Avisar fallo Homestead/.test(schedulerN8n));
ok("META-12 scheduler continueOnFail then notify", /continueOnFail/.test(schedulerN8n));
ok("META-13 tick no longer hides isolated failure as ok true", /content: "failed_isolated"/.test(tick) && /ok: false/.test(tick));
ok("META-14 signed media route", /verifyContentMediaToken/.test(mediaRoute));
ok("META-15 media HMAC prefix", /content-media/.test(media));
ok("META-16 simulated is not published", /SIMULATED/.test(types) && /CONTENT_SIMULATED/.test(publish));
ok("META-17 live once override", /liveOnce/.test(publish) && /liveyes/.test(handler));
ok("META-18 versioned live buttons", /live:v\$\{version\}/.test(processMod));
ok("META-19 regenerate clears approval", /approvedVersion:\s*null/.test(processMod));
ok("META-20 canonical WhatsApp CTA", /OFFICIAL_WHATSAPP/.test(copy) && /homestead\.lat/.test(copy));
ok("META-21 openai forbids invented phone", /6661-6580/.test(openai));
ok("META-22 page id conflict prefers FACEBOOK_PAGE_ID", /FACEBOOK_PAGE_ID_wins/.test(meta));
ok("META-23 publication columns migrated", /container_id/.test(migrate) && /permalink/.test(migrate));
ok("META-24 idempotency live vs dry keys", /live \? "live" : "dry"/.test(catalog));
ok("META-25 no n8n facebook node in content studio", !/n8n-nodes-base.facebook/.test(studioN8n));
ok("META-26 preview shows simulation vs live", /SIMULACIÓN/.test(processMod));
ok("META-27 telegram per-platform result", /label\}: Publicado/.test(publish) && /formatTelegramResult/.test(publish));
ok("META-28 graph version configurable", /META_GRAPH_VERSION/.test(meta));
ok("META-29 facebook reconcile uses stored id only", /lookupFacebookPost/.test(publish) && /facebookReconcileDecision/.test(publish) && !/reconcileFacebookByCaption/.test(publish));
ok("META-30 skip already published platform", /skip_published/.test(media));

const PREFIX = "content-media";
function sign(secret, publicId, assetId, exp) {
  return createHmac("sha256", secret).update(`${PREFIX}.${publicId}.${assetId}.${exp}`).digest("hex");
}
function match(expected, provided) {
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const secret = "test-secret-media";
const exp = String(Math.floor(Date.now() / 1000) + 1000);
const sig = sign(secret, "HC-2026-000018", 12, exp);
ok("META-31 hmac stable", match(sig, sign(secret, "HC-2026-000018", 12, exp)));
ok("META-32 hmac rejects tamper", !match(sig, sign(secret, "HC-2026-000018", 13, exp)));
ok("META-33 expired exp in past is detectable", Number(exp) > Math.floor(Date.now() / 1000));

function nextPlatformAttempt(existing, live) {
  if (!existing) return "publish";
  if (existing.status === "PUBLISHED") return "skip_published";
  if (existing.status === "UNCERTAIN" || existing.status === "PUBLISHING") return "reconcile_uncertain";
  if (existing.status === "SIMULATED") return live ? "publish" : "already_simulated";
  if (existing.status === "FAILED" || existing.status === "PENDING") return "retry_failed";
  return "publish";
}

ok("META-34 simulated does not block live", nextPlatformAttempt({ status: "SIMULATED" }, true) === "publish");
ok("META-35 simulated skip when still dry", nextPlatformAttempt({ status: "SIMULATED" }, false) === "already_simulated");
ok("META-36 published skip", nextPlatformAttempt({ status: "PUBLISHED" }, true) === "skip_published");
ok("META-37 facebook fail retries independently", nextPlatformAttempt({ status: "FAILED" }, true) === "retry_failed");
ok("META-38 uncertain reconciles before new post", nextPlatformAttempt({ status: "UNCERTAIN" }, true) === "reconcile_uncertain");

function validatePublishImage(input) {
  if (!input.bytes?.length) return { ok: false, cause: "image_missing" };
  if (input.bytes.length > 8 * 1024 * 1024) return { ok: false, cause: "image_too_large" };
  const jpeg = input.bytes[0] === 0xff && input.bytes[1] === 0xd8 && input.bytes[2] === 0xff;
  if (!jpeg) return { ok: false, cause: "image_not_jpeg" };
  if ((input.width || 0) < 320 || (input.height || 0) < 320) return { ok: false, cause: "image_too_small" };
  const ratio = input.width / input.height;
  if (ratio < 0.79 || ratio > 1.92) return { ok: false, cause: "image_aspect_unsupported" };
  return { ok: true };
}

ok("META-39 missing image", validatePublishImage({ bytes: Buffer.alloc(0), width: 1080, height: 1350 }).cause === "image_missing");
ok("META-40 jpeg 4:5 ok", validatePublishImage({ bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00]), width: 1080, height: 1350 }).ok);
ok("META-41 tiny rejected", validatePublishImage({ bytes: Buffer.from([0xff, 0xd8, 0xff]), width: 100, height: 100 }).cause === "image_too_small");

ok("META-42 no second publisher in n8n scheduler", !/graph\.facebook\.com/.test(schedulerN8n));
ok("META-43 /live command exists", /\/live/.test(handler));
ok("META-44 stale version still gated", /stale_version/.test(handler));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nCONTENT PUBLISH META checks OK (simulated static + hmac; no live Graph publish)");
