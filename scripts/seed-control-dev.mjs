import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir =
  process.env.HOMESTEAD_CONTROL_ISOLATED === "true" && process.env.DATA_DIR
    ? process.env.DATA_DIR
    : applyControlIsolatedEnv(root);
assertSafeToMutateControlDev(dataDir, "seed");

const sharp = (await import("sharp")).default;
const { getHomesteadDb } = await import("../src/lib/service-requests.ts");
const {
  createContentJob,
  saveVersion,
  storeOriginal,
  storeDerivedAsset,
  updateJob,
  recordPublication,
  recordContentEvent,
} = await import("../src/lib/content-catalog.ts");
const { insertCampaign, insertPiece } = await import("../src/lib/campaign-store.ts");

getHomesteadDb();

async function jpeg(color) {
  return sharp({
    create: { width: 800, height: 1000, channels: 3, background: color },
  })
    .jpeg()
    .toBuffer();
}

async function makeJob(status, caption, extra = {}) {
  const job = createContentJob({ chatId: "control-seed", userId: "seed" });
  const bytes = await jpeg(extra.color || "#6b7c6a");
  storeOriginal({ job, bytes, mime: "image/jpeg", ext: "jpg" });
  storeDerivedAsset({
    job,
    version: 1,
    assetType: "BRANDED",
    role: "PRIMARY",
    bytes,
    mime: "image/jpeg",
    ext: "jpg",
    folder: "branded",
    filename: "branded-v1-001-feed.jpg",
    width: 800,
    height: 1000,
  });
  saveVersion({
    job,
    version: 1,
    kind: "full",
    copy: caption,
    cta: "Agenda en homestead.lat",
    hashtags: "#HomesteadServices #Panama",
    prompt: "seed",
    privacyNote: "",
  });
  updateJob(job.publicId, {
    status,
    selectedCaption: caption,
    approvedVersion: extra.approvedVersion ?? (status === "AWAITING_APPROVAL" ? null : 1),
    recommendedPublishAt: extra.recommendedPublishAt || null,
    recommendationReason: extra.recommendationReason || "",
    lastError: extra.lastError || null,
    campaignPublicId: extra.campaignPublicId || "",
  });
  recordContentEvent(job.publicId, "SEED", status);
  return job.publicId;
}

const pending = await makeJob("AWAITING_APPROVAL", "Pieza ficticia pendiente de aprobación.");
const approved = await makeJob("APPROVED", "Pieza ficticia aprobada sin programar.");
const scheduled = await makeJob("SCHEDULED", "Pieza ficticia programada.", {
  recommendedPublishAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  recommendationReason: "Horario de prueba America/Panama",
});
const published = await makeJob("PUBLISHED", "Pieza ficticia publicada en ambas redes.");
recordPublication({
  publicId: published,
  platform: "instagram",
  dryRun: false,
  status: "PUBLISHED",
  caption: "ok",
  externalPostId: "sim-ig-pub",
});
recordPublication({
  publicId: published,
  platform: "facebook",
  dryRun: false,
  status: "PUBLISHED",
  caption: "ok",
  externalPostId: "sim-fb-pub",
});

const inconsistent = await makeJob(
  "NEEDS_REVIEW",
  "Escenario ficticio al estilo HC-040: el job dice NEEDS_REVIEW pero ambas redes figuran PUBLISHED. No es el registro de producción.",
  { lastError: "job_publication_mismatch", color: "#8a5a44" },
);
recordPublication({
  publicId: inconsistent,
  platform: "instagram",
  dryRun: false,
  status: "PUBLISHED",
  caption: "ok",
  externalPostId: "sim-ig-040",
});
recordPublication({
  publicId: inconsistent,
  platform: "facebook",
  dryRun: false,
  status: "PUBLISHED",
  caption: "ok",
  externalPostId: "sim-fb-040",
});

const partial = await makeJob("NEEDS_REVIEW", "Publicación parcial ficticia: Instagram ok, Facebook falló.", {
  lastError: "simulated_facebook_denied",
  color: "#4a5c8a",
});
recordPublication({
  publicId: partial,
  platform: "instagram",
  dryRun: false,
  status: "PUBLISHED",
  caption: "ok",
  externalPostId: "sim-ig-partial",
});
recordPublication({
  publicId: partial,
  platform: "facebook",
  dryRun: false,
  status: "FAILED",
  caption: "ok",
  error: "simulated_facebook_denied",
});

const campaign = insertCampaign({
  status: "SCHEDULED",
  service: "Cerraduras",
  serviceSlug: "cerraduras",
  zone: "Panamá",
  audience: "hogares",
  problem: "seguridad",
  benefit: "acceso",
  offer: "",
  objections: "",
  evidence: "",
  conversionChannel: "web",
  objective: "consultas",
  startsAt: null,
  endsAt: null,
  requestedHorizonDays: 14,
  scheduledHorizonDays: 14,
  scheduleNote: "Datos ficticios de Control",
  maxGeneration: 0,
  generationUsed: 0,
  experimentJson: "{}",
  approvalManifest: "{}",
  telegramChatId: "control-seed",
  isTest: 1,
});
insertPiece({
  campaignId: campaign.publicId,
  status: "SCHEDULED",
  version: 1,
  approvedVersion: 1,
  pillar: "trust",
  format: "SINGLE_IMAGE",
  objective: "",
  problem: "",
  hook: "",
  benefit: "",
  evidence: "",
  objection: "",
  visualNeed: "",
  copy: "Pieza de campaña ficticia",
  altCopy: "",
  overlayText: "",
  cta: "",
  altText: "",
  hypothesis: "",
  destinationUrl: "",
  whatsappUrl: "",
  contentJobId: scheduled,
  scheduledAt: new Date().toISOString(),
  editorialScore: 0,
});
updateJob(scheduled, { campaignPublicId: campaign.publicId });

console.log(
  JSON.stringify(
    {
      dataDir,
      pending,
      approved,
      scheduled,
      published,
      inconsistent,
      partial,
      campaign: campaign.publicId,
    },
    null,
    2,
  ),
);
