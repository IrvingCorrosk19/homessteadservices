import {
  beginProcessLock,
  clearProcessLock,
  createContentJob,
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
  storeOriginal,
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
  generateCampaignImage,
  rewriteCopyOnly,
  writeAiCampaignCopy,
} from "@/lib/content-openai";
import { sendTelegramMessage, sendTelegramPhotos } from "@/lib/content-telegram";
import { enqueueForApproval, formatPanama } from "@/lib/content-queue";
import { logError, logInfo } from "@/lib/log";
import type { ContentAssetRole } from "@/lib/content-types";
import type { ContentJob } from "@/lib/content-types";

function reviewKeyboard(publicId: string, version: number) {
  return [
    [{ text: "✅ APROBAR", callback_data: `cs:${publicId}:approve:v${version}` }],
    [{ text: "PUBLICAR AHORA", callback_data: `cs:${publicId}:now:v${version}` }],
    [{ text: "APROBAR HORARIO", callback_data: `cs:${publicId}:slot:v${version}` }],
    [
      { text: "✏️ CAMBIAR", callback_data: `cs:${publicId}:edit:v${version}` },
      { text: "🔄 OTRA VERSIÓN", callback_data: `cs:${publicId}:alt:v${version}` },
    ],
    [
      { text: "CAMBIAR FECHA", callback_data: `cs:${publicId}:date:v${version}` },
      { text: "❌ DESCARTAR", callback_data: `cs:${publicId}:drop:v${version}` },
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
  const isAi = fresh.contentType === "AI_CAMPAIGN";
  const text = [
    "HOMESTEAD CONTENT",
    "",
    fresh.publicId,
    `Versión: V${version}`,
    "",
    `Servicio: ${fresh.serviceType || fresh.mixType || "mantenimiento"}`,
    `Origen: ${isAi ? "Creatividad AI (no es evidencia de trabajo real)" : "Fotos de trabajo real"}`,
    `Formato: ${fresh.format || "Instagram"}`,
    `Recomendado: ${when}`,
    "",
    copy,
    "",
    hashtags,
    "",
    "Estado: LISTO PARA REVISIÓN",
    settings.dryRun ? "Modo: DRY RUN (no publica en redes sin configuración Meta)" : "",
    ...extra,
  ]
    .filter(Boolean)
    .join("\n");
  await sendTelegramMessage({
    chatId: job.telegramChatId,
    text,
    keyboard: reviewKeyboard(job.publicId, version),
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
  if (job.sourceJobId) {
    const { getServiceJob } = await import("@/lib/job-store");
    const source = getServiceJob(job.sourceJobId);
    if (source && !source.marketingUsageApproved) {
      await sendTelegramMessage({
        chatId: job.telegramChatId,
        text: "Homestead no procesa estas fotos hasta que autorices su uso para marketing en el trabajo.",
      });
      clearProcessLock(publicId);
      return;
    }
  }
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
    updateJob(publicId, { approvedAt: null });
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
  updateJob(publicId, {
    selectedCaption: rewritten.full,
    pendingInput: null,
    status: "AWAITING_APPROVAL",
    approvedAt: null,
  });
  recordContentEvent(publicId, "CONTENT_REVISION", `v${next}`);
  await sendPreview(job, next, rewritten.full, rewritten.hashtags.join(" "), [
    "La versión anterior ya no está aprobada. Revisa V" + next + ".",
  ]);
}

export async function processAiCampaignJob(publicId: string) {
  const job = getJobByPublicId(publicId);
  if (!job) return;
  try {
    updateJob(publicId, { status: "PROCESSING", lastError: null, contentType: "AI_CAMPAIGN" });
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: `Preparé una propuesta AI.\n\n${publicId}\n\nGenerando 1 visual + copy. Esto puede tomar un minuto.`,
    });
    logInfo("ImageGenerationStarted", { contentJobId: publicId, stage: "AI_CAMPAIGN" });
    const generated = await generateCampaignImage({
      publicId,
      service: job.serviceType || "servicios del hogar",
      platform: job.format || "Instagram",
      note: job.description,
    });
    if (!generated) {
      throw new Error("image_generation_failed");
    }
    const jpeg = await toJpeg(generated);
    const meta = await metadataOf(jpeg);
    if (originalCount(publicId) < 1) {
      storeOriginal({
        job,
        bytes: jpeg,
        mime: "image/jpeg",
        ext: "jpg",
        width: meta.width,
        height: meta.height,
      });
    }
    const copy = await writeAiCampaignCopy({
      publicId,
      service: job.serviceType || "servicios del hogar",
      platform: job.format || "Instagram",
      note: job.description,
    });
    const version = nextVersionNumber(publicId);
    const enhanced = await enhanceDeterministic(jpeg);
    const enhancedMeta = await metadataOf(enhanced);
    storeDerivedAsset({
      job,
      version,
      assetType: "ENHANCED",
      role: "PRIMARY",
      bytes: enhanced,
      mime: "image/jpeg",
      ext: "jpg",
      folder: "enhanced",
      filename: `enhanced-v${version}-001.jpg`,
      width: enhancedMeta.width,
      height: enhancedMeta.height,
    });
    const branded = await brandedSocialSet(enhanced);
    storeDerivedAsset({
      job,
      version,
      assetType: "BRANDED",
      role: "PRIMARY",
      bytes: branded.feed.bytes,
      mime: "image/jpeg",
      ext: "jpg",
      folder: "branded",
      filename: `branded-v${version}-001-feed.jpg`,
      width: branded.feed.width,
      height: branded.feed.height,
    });
    storeDerivedAsset({
      job,
      version,
      assetType: "BRANDED",
      role: "PRIMARY",
      bytes: branded.square.bytes,
      mime: "image/jpeg",
      ext: "jpg",
      folder: "branded",
      filename: `branded-v${version}-001-square.jpg`,
      width: branded.square.width,
      height: branded.square.height,
    });
    const hashtags = copy.hashtags.join(" ");
    saveVersion({
      job,
      version,
      kind: "full",
      copy: copy.full,
      cta: copy.cta,
      hashtags,
      prompt: "ai_campaign_v3",
      privacyNote: "AI_GENERATED — no es evidencia de trabajo real",
    });
    updateJob(publicId, {
      selectedCaption: copy.full,
      captionsJson: JSON.stringify({
        commercial: copy.commercial,
        warm: copy.warm,
        educational: copy.educational,
      }),
      mixType: "AI_CAMPAIGN",
      contentType: "AI_CAMPAIGN",
      approvedAt: null,
    });
    recordUsage(publicId, "openai", "ai_campaign");
    recordContentEvent(publicId, "CONTENT_PROCESSED", `ai-v${version}`);
    const queued = getJobByPublicId(publicId) || job;
    enqueueForApproval(queued);
    logInfo("PreviewSent", { contentJobId: publicId, stage: `ai-v${version}` });
    await sendPreview(queued, version, copy.full, hashtags, [
      "⚠️ Creatividad generada por IA. No representa un trabajo real de Homestead.",
    ]);
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown";
    logError("ContentProcessingFailed", { contentJobId: publicId, cause: cause.slice(0, 180) });
    updateJob(publicId, { status: "FAILED", lastError: cause.slice(0, 180) });
    await sendTelegramMessage({
      chatId: job.telegramChatId,
      text: "Tuve un problema preparando la imagen.\n¿Quieres que lo intente otra vez?",
      keyboard: [[{ text: "🔄 REINTENTAR", callback_data: `cs:${publicId}:aigen` }]],
    });
  } finally {
    clearProcessLock(publicId);
  }
}

export async function startAiCampaignFromChat(input: {
  chatId: string;
  userId: string;
  service: string;
  platform: string;
  note: string;
}) {
  const job = createContentJob({ chatId: input.chatId, userId: input.userId });
  updateJob(job.publicId, {
    status: "PROCESSING",
    description: input.note.slice(0, 2000),
    serviceType: input.service,
    format: input.platform,
    contentType: "AI_CAMPAIGN",
    mixType: "AI_CAMPAIGN",
    ctaType: "BOOK",
  });
  recordContentEvent(job.publicId, "CAMPAIGN_INTENT", "AI_CAMPAIGN");
  logInfo("ContentJobCreated", { contentJobId: job.publicId, stage: "AI_CAMPAIGN" });
  if (!beginProcessLock(job.publicId)) {
    return job.publicId;
  }
  void processAiCampaignJob(job.publicId);
  return job.publicId;
}
