import {
  clearProcessLock,
  getJobByPublicId,
  latestVersion,
  listAssets,
  nextVersionNumber,
  originalCount,
  readAssetBytes,
  recordContentEvent,
  recordUsage,
  saveVersion,
  sha256Of,
  storeDerivedAsset,
  updateJob,
  getContentSettings,
} from "@/lib/content-catalog";
import {
  brandedSocialSet,
  enhanceDeterministic,
  metadataOf,
  toJpeg,
} from "@/lib/content-images";
import {
  analyzeAndWriteCopy,
  enhanceWithOpenAi,
  rewriteCopyOnly,
} from "@/lib/content-openai";
import { sendTelegramMessage, sendTelegramPhotos } from "@/lib/content-telegram";
import { enqueueForApproval, formatPanama } from "@/lib/content-queue";
import { logError, logInfo } from "@/lib/log";
import type { ContentAssetRole } from "@/lib/content-types";
import type { ContentJob } from "@/lib/content-types";

function reviewKeyboard(publicId: string) {
  return [
    [{ text: "PUBLICAR AHORA", callback_data: `cs:${publicId}:now` }],
    [{ text: "APROBAR HORARIO", callback_data: `cs:${publicId}:slot` }],
    [
      { text: "CAMBIAR FECHA", callback_data: `cs:${publicId}:date` },
      { text: "CAMBIAR TEXTO", callback_data: `cs:${publicId}:edit` },
    ],
    [
      { text: "OTRA VERSIÓN", callback_data: `cs:${publicId}:alt` },
      { text: "DESCARTAR", callback_data: `cs:${publicId}:drop` },
    ],
  ];
}

function failKeyboard(publicId: string) {
  return [[{ text: "🔄 REINTENTAR", callback_data: `cs:${publicId}:retry` }]];
}

function privacyLines(analysis: {
  privacy: { people: boolean; plates: boolean; documents: boolean; warning: string };
}) {
  const lines: string[] = [];
  if (analysis.privacy.people) {
    lines.push("⚠️ Se detectaron personas visibles. Confirma autorización antes de publicar.");
  }
  if (analysis.privacy.plates || analysis.privacy.documents) {
    lines.push("⚠️ REVISIÓN DE PRIVACIDAD RECOMENDADA");
  }
  if (analysis.privacy.warning) lines.push(analysis.privacy.warning);
  return lines;
}

async function sendPreview(job: ContentJob, version: number, copy: string, hashtags: string, extra: string[]) {
  const branded = listAssets(job.publicId, "BRANDED", version).filter((asset) =>
    asset.storedFilename.includes("-feed."),
  );
  const photos = branded.flatMap((asset) => {
    const bytes = readAssetBytes(asset);
    return bytes ? [{ bytes, filename: asset.storedFilename }] : [];
  });
  if (photos.length) {
    await sendTelegramPhotos({ chatId: job.telegramChatId, photos: photos.slice(0, 8) });
  }
  const fresh = getJobByPublicId(job.publicId) || job;
  const settings = getContentSettings();
  const when = fresh.recommendedPublishAt
    ? formatPanama(fresh.recommendedPublishAt, settings)
    : "por definir";
  const text = [
    "HOMESTEAD CONTENT",
    "",
    fresh.publicId,
    "",
    `Trabajo: ${fresh.serviceType || fresh.mixType || "mantenimiento"}`,
    "Destino: Instagram + Facebook",
    `Recomendado: ${when}`,
    "",
    copy,
    "",
    hashtags,
    "",
    `Estado: LISTO PARA PUBLICAR`,
    settings.dryRun ? "Modo: DRY RUN (no publica en redes hasta que lo actives)" : "",
    ...extra,
  ]
    .filter(Boolean)
    .join("\n");
  await sendTelegramMessage({
    chatId: job.telegramChatId,
    text,
    keyboard: reviewKeyboard(job.publicId),
  });
}

async function renderVersion(
  job: ContentJob,
  kind: "full" | "image",
  analysisCopy?: { full: string; cta: string; hashtags: string[]; prompt: string; privacyNote: string },
) {
  const originals = listAssets(job.publicId, "ORIGINAL", 0);
  const before = originals.map((asset) => ({
    path: asset.relativePath,
    sha: sha256Of(readAssetBytes(asset)!),
  }));
  const photos = originals.map((asset) => ({
    asset,
    bytes: readAssetBytes(asset)!,
    mime: asset.mimeType,
  }));

  logInfo("ImageAnalysisStarted", { contentJobId: job.publicId });
  let analysis;
  try {
    analysis = await analyzeAndWriteCopy({
      publicId: job.publicId,
      description: job.description,
      photos: await Promise.all(
        photos.map(async (item) => ({ bytes: await toJpeg(item.bytes), mime: "image/jpeg" })),
      ),
    });
  } catch (error) {
    logError("ImageAnalysisFailed", {
      contentJobId: job.publicId,
      cause: error instanceof Error ? error.message.slice(0, 180) : "unknown",
    });
    analysis = {
      serviceGuess: job.serviceType,
      ratings: photos.map((_, index) => ({
        index: index + 1,
        label: (index === 0 ? "PRIMARY" : "SECONDARY") as "PRIMARY" | "SECONDARY",
        notes: "",
      })),
      privacy: { people: false, plates: false, documents: false, warning: "" },
      copy: {
        full: job.description
          ? `Homestead Services en Panamá.\n\n${job.description}\n\nTrabajo real, bien hecho y con seguimiento claro.\n\nAgenda tu servicio.`
          : "Homestead Services en Panamá.\nTrabajo real de mantenimiento y reparación.\nAgenda tu servicio.",
        cta: "Agenda tu servicio",
        hashtags: ["#HomesteadServices", "#Panama", "#Mantenimiento"],
      },
    };
  }
  logInfo("ImageAnalysisCompleted", { contentJobId: job.publicId });

  const version = nextVersionNumber(job.publicId);
  const copy = analysisCopy?.full || analysis.copy.full;
  const cta = analysisCopy?.cta || analysis.copy.cta;
  const hashtags = (analysisCopy?.hashtags || analysis.copy.hashtags).join(" ");

  for (const [index, item] of photos.entries()) {
    const rating = analysis.ratings.find((entry) => entry.index === index + 1);
    const role = (rating?.label || (index === 0 ? "PRIMARY" : "SECONDARY")) as ContentAssetRole;
    if (role === "LOW_QUALITY" || role === "DUPLICATE") continue;
    logInfo("ImageEnhancementStarted", { contentJobId: job.publicId, stage: item.asset.storedFilename });
    const jpegInput = await toJpeg(item.bytes);
    const ai =
      kind === "image" || kind === "full"
        ? await enhanceWithOpenAi({
            publicId: job.publicId,
            bytes: jpegInput,
          })
        : null;
    const enhanced = ai || (await enhanceDeterministic(jpegInput));
    const meta = await metadataOf(enhanced);
    storeDerivedAsset({
      job,
      version,
      assetType: "ENHANCED",
      role,
      bytes: enhanced,
      mime: "image/jpeg",
      ext: "jpg",
      folder: "enhanced",
      filename: `enhanced-v${version}-${String(index + 1).padStart(3, "0")}.jpg`,
      width: meta.width,
      height: meta.height,
    });
    logInfo("ImageEnhancementCompleted", { contentJobId: job.publicId, stage: item.asset.storedFilename });
    const branded = await brandedSocialSet(enhanced);
    logInfo("WatermarkApplied", { contentJobId: job.publicId, stage: item.asset.storedFilename });
    storeDerivedAsset({
      job,
      version,
      assetType: "BRANDED",
      role,
      bytes: branded.feed.bytes,
      mime: "image/jpeg",
      ext: "jpg",
      folder: "branded",
      filename: `branded-v${version}-${String(index + 1).padStart(3, "0")}-feed.jpg`,
      width: branded.feed.width,
      height: branded.feed.height,
    });
    storeDerivedAsset({
      job,
      version,
      assetType: "BRANDED",
      role,
      bytes: branded.square.bytes,
      mime: "image/jpeg",
      ext: "jpg",
      folder: "branded",
      filename: `branded-v${version}-${String(index + 1).padStart(3, "0")}-square.jpg`,
      width: branded.square.width,
      height: branded.square.height,
    });
  }

  const after = originals.map((asset) => ({
    path: asset.relativePath,
    sha: sha256Of(readAssetBytes(asset)!),
  }));
  const immutable = before.every((item, index) => item.sha === after[index]?.sha);

  saveVersion({
    job,
    version,
    kind,
    copy,
    cta,
    hashtags,
    prompt: analysisCopy?.prompt || `analysis:${textSummary(analysis)}`,
    privacyNote: privacyLines(analysis).join(" "),
  });
  recordUsage(job.publicId, "homestead", kind === "full" ? "process" : "reimage");
  logInfo("CopyGenerated", { contentJobId: job.publicId, stage: `v${version}` });
  const captions = {
    commercial: analysis.copy.commercial || copy,
    warm: analysis.copy.warm || copy,
    educational: analysis.copy.educational || copy,
  };
  updateJob(job.publicId, {
    serviceType: analysis.serviceGuess || job.serviceType,
    captionsJson: JSON.stringify(captions),
    selectedCaption: copy,
  });
  recordContentEvent(job.publicId, "CONTENT_PROCESSED", `v${version}`);
  return { version, copy, cta, hashtags, extra: privacyLines(analysis), immutable };
}

function textSummary(analysis: Awaited<ReturnType<typeof analyzeAndWriteCopy>>) {
  return analysis.ratings.map((item) => `${item.index}:${item.label}`).join(",");
}

export async function processContentJob(publicId: string, kind: "full" | "image" = "full") {
  const job = getJobByPublicId(publicId);
  if (!job) return;
  if (originalCount(publicId) < 1) {
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: "Todavía no hay fotografías para procesar.",
    });
    clearProcessLock(publicId);
    return;
  }
  try {
    updateJob(publicId, { status: "PROCESSING", lastError: null });
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: `🏠 HOMESTEAD CONTENT STUDIO\n\n${publicId}\n\nProcesando fotografías y copy. Esto puede tomar un minuto.`,
    });
    const result = await renderVersion(job, kind);
    const queued = getJobByPublicId(publicId) || job;
    enqueueForApproval(queued);
    recordContentEvent(publicId, "CONTENT_READY", `v${result.version}`);
    logInfo("PreviewSent", { contentJobId: publicId, stage: `v${result.version}` });
    await sendPreview(queued, result.version, result.copy, result.hashtags, result.extra);
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    logError("ContentProcessingFailed", { contentJobId: publicId, cause: cause.slice(0, 180) });
    updateJob(publicId, { status: "FAILED", lastError: cause.slice(0, 180) });
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: "⚠️ No pudimos procesar las imágenes.\n\nTus originales están seguros.",
      keyboard: failKeyboard(publicId),
    });
  } finally {
    clearProcessLock(publicId);
  }
}

export async function regenerateCopy(publicId: string, instruction?: string) {
  const job = getJobByPublicId(publicId);
  const previous = latestVersion(publicId);
  if (!job || !previous) return;
  const next = nextVersionNumber(publicId);
  const rewritten = await rewriteCopyOnly({
    publicId,
    description: job.description,
    previousCopy: previous.copy,
    instruction,
  });
  saveVersion({
    job,
    version: next,
    kind: "copy",
    copy: rewritten.full,
    cta: rewritten.cta,
    hashtags: rewritten.hashtags.join(" "),
    prompt: "copy_only",
    privacyNote: previous.privacyNote,
  });
  const branded = listAssets(job.publicId, "BRANDED", previous.version);
  for (const asset of branded) {
    const bytes = readAssetBytes(asset);
    if (!bytes) continue;
    storeDerivedAsset({
      job,
      version: next,
      assetType: "BRANDED",
      role: asset.role,
      bytes,
      mime: asset.mimeType,
      ext: "jpg",
      folder: "branded",
      filename: asset.storedFilename.replace(`-v${previous.version}-`, `-v${next}-`),
      width: asset.width,
      height: asset.height,
    });
  }
  logInfo("ContentRegenerated", { contentJobId: publicId, stage: `copy-v${next}` });
  updateJob(publicId, { selectedCaption: rewritten.full, pendingInput: null });
  await sendPreview(job, next, rewritten.full, rewritten.hashtags.join(" "), []);
}
