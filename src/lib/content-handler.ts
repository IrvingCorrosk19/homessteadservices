import {
  activeJobForChat,
  beginProcessLock,
  clearProcessLock,
  createContentJob,
  getContentSettings,
  getJobByPublicId,
  jobAwaitingInput,
  listJobsByStatus,
  originalCount,
  recordContentEvent,
  seenTelegramUpdate,
  setContentPaused,
  storeOriginal,
  updateJob,
} from "@/lib/content-catalog";
import { processContentJob, regenerateCopy } from "@/lib/content-process";
import { formatPanama, parsePanamaDateTime } from "@/lib/content-queue";
import { publishJob } from "@/lib/content-publish";
import { metadataOf } from "@/lib/content-images";
import { sniffImage } from "@/lib/photos";
import {
  answerCallback,
  downloadTelegramFile,
  isTelegramAdmin,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/content-telegram";
import { MAX_CONTENT_PHOTO_BYTES, MAX_CONTENT_PHOTOS } from "@/lib/content-types";
import { logError, logInfo } from "@/lib/log";

function receivingKeyboard(publicId: string) {
  return [
    [
      { text: "✨ PROCESAR", callback_data: `cs:${publicId}:process` },
      { text: "❌ CANCELAR", callback_data: `cs:${publicId}:cancel` },
    ],
  ];
}

function existingKeyboard(publicId: string) {
  return [
    [
      { text: "CONTINUAR", callback_data: `cs:${publicId}:continue` },
      { text: "CANCELAR", callback_data: `cs:${publicId}:cancel` },
    ],
  ];
}

function rejectKeyboard(publicId: string) {
  return [
    [
      { text: "CONFIRMAR", callback_data: `cs:${publicId}:rejectyes` },
      { text: "VOLVER", callback_data: `cs:${publicId}:rejectno` },
    ],
  ];
}

function parseCallback(data: string) {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "cs") return null;
  return { publicId: parts[1], action: parts[2] };
}

async function remindReceiving(chatId: string, publicId: string, count: number, messageId?: number | null) {
  const text = [
    "🏠 HOMESTEAD CONTENT STUDIO",
    "",
    `📸 ${count} ${count === 1 ? "fotografía recibida" : "fotografías recibidas"}`,
    "",
    publicId,
    "",
    "Puedes agregar más fotografías o escribir una nota corta del trabajo.",
  ].join("\n");
  const sent = await sendTelegramMessage({
    chatId,
    text,
    keyboard: receivingKeyboard(publicId),
    editMessageId: messageId,
  });
  if (sent) updateJob(publicId, { telegramStatusMessageId: sent });
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (!process.env.CONTENT_STUDIO_ENABLED || process.env.CONTENT_STUDIO_ENABLED === "false") {
    return { ok: true, skipped: "disabled" };
  }
  if (seenTelegramUpdate(update.update_id)) {
    return { ok: true, duplicate: true };
  }

  const callback = update.callback_query;
  if (callback?.data) {
    const chatId = String(callback.message?.chat.id || callback.from.id);
    const userId = String(callback.from.id);
    if (!isTelegramAdmin(chatId, userId)) {
      logError("ContentStudioUnauthorized", { stage: "callback", contentJobId: chatId.slice(0, 24) });
      await answerCallback(callback.id, "No autorizado");
      return { ok: true, denied: true };
    }
    await answerCallback(callback.id);
    const parsed = parseCallback(callback.data);
    if (!parsed) return { ok: true };
    const job = getJobByPublicId(parsed.publicId);
    if (!job || job.telegramChatId !== chatId) return { ok: true };
    if (parsed.action === "process" || parsed.action === "retry" || parsed.action === "reimage") {
      if (!beginProcessLock(job.publicId)) {
        await sendTelegramMessage({
          chatId,
          text: "Ya hay un procesamiento en curso. Espera un momento.",
        });
        return { ok: true };
      }
      const kind = parsed.action === "reimage" ? "image" : "full";
      logInfo("ContentJobCreated", { contentJobId: job.publicId, stage: parsed.action });
      void processContentJob(job.publicId, kind);
      return { ok: true };
    }
    if (parsed.action === "copy") {
      if (!beginProcessLock(job.publicId, 60_000)) return { ok: true };
      void regenerateCopy(job.publicId).finally(() => clearProcessLock(job.publicId));
      return { ok: true };
    }
    if (parsed.action === "regen") {
      if (!beginProcessLock(job.publicId)) return { ok: true };
      void processContentJob(job.publicId, "full");
      return { ok: true };
    }
    if (parsed.action === "now") {
      void publishJob(job.publicId, "now");
      return { ok: true };
    }
    if (parsed.action === "slot") {
      updateJob(job.publicId, {
        status: "SCHEDULED",
        approvedAt: new Date().toISOString(),
        pendingInput: null,
      });
      recordContentEvent(job.publicId, "CONTENT_APPROVED", "schedule");
      const settings = getContentSettings();
      await sendTelegramMessage({
        chatId,
        text: [
          "Horario aprobado.",
          "",
          job.publicId,
          job.recommendedPublishAt
            ? formatPanama(job.recommendedPublishAt, settings)
            : "sin hora",
          "",
          getContentSettings().dryRun
            ? "Al llegar la hora haré DRY RUN (no publica en redes todavía)."
            : "El scheduler lo publicará a esa hora.",
        ].join("\n"),
      });
      return { ok: true };
    }
    if (parsed.action === "date") {
      updateJob(job.publicId, { pendingInput: "date" });
      await sendTelegramMessage({
        chatId,
        text: "Escribe la nueva fecha y hora en hora de Panamá. Ejemplo:\n20/08 7:00 p.m.",
      });
      return { ok: true };
    }
    if (parsed.action === "edit") {
      updateJob(job.publicId, { pendingInput: "copy" });
      await sendTelegramMessage({
        chatId,
        text: "Dime cómo quieres el texto. Ejemplo: más corto, más profesional, menos emojis.",
      });
      return { ok: true };
    }
    if (parsed.action === "alt") {
      if (!beginProcessLock(job.publicId, 60_000)) return { ok: true };
      void regenerateCopy(job.publicId, "otra versión, mismo hecho").finally(() =>
        clearProcessLock(job.publicId),
      );
      return { ok: true };
    }
    if (parsed.action === "drop") {
      await sendTelegramMessage({
        chatId,
        text: "¿Descartar esta propuesta?",
        keyboard: rejectKeyboard(job.publicId),
      });
      return { ok: true };
    }
    if (parsed.action === "approve") {
      if (job.status !== "READY_FOR_REVIEW" && job.status !== "AWAITING_APPROVAL") {
        await sendTelegramMessage({
          chatId,
          text: "Esta propuesta todavía no está lista para aprobar.",
        });
        return { ok: true };
      }
      const now = new Date().toISOString();
      updateJob(job.publicId, { status: "APPROVED", approvedAt: now });
      logInfo("ContentApproved", { contentJobId: job.publicId });
      await sendTelegramMessage({
        chatId,
        text: [
          "✅ CONTENIDO APROBADO",
          "",
          job.publicId,
          "",
          "Guardado en Homestead Content Studio.",
          "Originales conservados.",
          "Versiones procesadas guardadas.",
          "Copy guardado.",
          "",
          "Todavía NO ha sido publicado en ninguna red social.",
        ].join("\n"),
      });
      return { ok: true };
    }
    if (parsed.action === "reject") {
      await sendTelegramMessage({
        chatId,
        text: "¿Descartar esta propuesta?",
        keyboard: rejectKeyboard(job.publicId),
      });
      return { ok: true };
    }
    if (parsed.action === "rejectyes") {
      updateJob(job.publicId, {
        status: "REJECTED",
        rejectedAt: new Date().toISOString(),
      });
      logInfo("ContentRejected", { contentJobId: job.publicId });
      await sendTelegramMessage({
        chatId,
        text: `Propuesta descartada.\n\n${job.publicId}\n\nLos originales se conservan.`,
      });
      return { ok: true };
    }
    if (parsed.action === "rejectno" || parsed.action === "continue") {
      const count = originalCount(job.publicId);
      await remindReceiving(chatId, job.publicId, count, job.telegramStatusMessageId);
      return { ok: true };
    }
    if (parsed.action === "cancel") {
      updateJob(job.publicId, { status: "REJECTED", rejectedAt: new Date().toISOString() });
      await sendTelegramMessage({
        chatId,
        text: `Publicación cancelada.\n\n${job.publicId}\n\nLos originales se conservan.`,
      });
      return { ok: true };
    }
    return { ok: true };
  }

  const message = update.message;
  if (!message) return { ok: true };
  const chatId = String(message.chat.id);
  const userId = String(message.from?.id || message.chat.id);
  const text = (message.text || "").trim();
  if (!isTelegramAdmin(chatId, userId)) {
    logError("ContentStudioUnauthorized", { stage: "message", contentJobId: chatId.slice(0, 24) });
    if (text === "/publicar" || text.startsWith("/publicar@")) {
      await sendTelegramMessage({ chatId, text: "No autorizado." });
    }
    return { ok: true, denied: true };
  }

  if (text === "/pendientes" || text.startsWith("/pendientes@")) {
    const rows = listJobsByStatus(["AWAITING_APPROVAL", "READY_FOR_REVIEW"]);
    await sendTelegramMessage({
      chatId,
      text: rows.length
        ? `Pendientes de aprobación:\n\n${rows.map((row) => `${row.publicId} — ${row.serviceType || row.mixType}`).join("\n")}`
        : "No hay contenidos pendientes de aprobación.",
    });
    return { ok: true };
  }
  if (text === "/programadas" || text.startsWith("/programadas@")) {
    const rows = listJobsByStatus(["SCHEDULED"]);
    const settings = getContentSettings();
    await sendTelegramMessage({
      chatId,
      text: rows.length
        ? `Programadas:\n\n${rows
            .map(
              (row) =>
                `${row.recommendedPublishAt ? formatPanama(row.recommendedPublishAt, settings) : "sin hora"} — ${row.publicId} ${row.serviceType || ""}`.trim(),
            )
            .join("\n")}`
        : "No hay publicaciones programadas.",
    });
    return { ok: true };
  }
  if (text === "/publicadas" || text.startsWith("/publicadas@")) {
    const rows = listJobsByStatus(["PUBLISHED"]);
    await sendTelegramMessage({
      chatId,
      text: rows.length
        ? `Publicadas:\n\n${rows.map((row) => `${row.publicId} — ${row.serviceType || row.mixType}`).join("\n")}`
        : "Aún no hay publicaciones registradas.",
    });
    return { ok: true };
  }
  if (text === "/proxima" || text.startsWith("/proxima@")) {
    const next = listJobsByStatus(["SCHEDULED"])[0];
    const settings = getContentSettings();
    await sendTelegramMessage({
      chatId,
      text: next
        ? `Próxima:\n\n${next.publicId}\n${next.recommendedPublishAt ? formatPanama(next.recommendedPublishAt, settings) : "sin hora"}`
        : "No hay una próxima publicación programada.",
    });
    return { ok: true };
  }
  if (text === "/estado" || text.startsWith("/estado@")) {
    const settings = getContentSettings();
    await sendTelegramMessage({
      chatId,
      text: [
        "HOMESTEAD CONTENT",
        `Modo: ${settings.mode}`,
        `DRY RUN: ${settings.dryRun ? "sí" : "no"}`,
        `Pausa: ${settings.paused ? "sí" : "no"}`,
        `Zona: ${settings.timezone}`,
        `Pendientes: ${listJobsByStatus(["AWAITING_APPROVAL"]).length}`,
        `Programadas: ${listJobsByStatus(["SCHEDULED"]).length}`,
      ].join("\n"),
    });
    return { ok: true };
  }
  if (text === "/pausa" || text.startsWith("/pausa@")) {
    setContentPaused(true);
    await sendTelegramMessage({ chatId, text: "Autopublicación en pausa. El scheduler no publicará." });
    return { ok: true };
  }
  if (text === "/reanudar" || text.startsWith("/reanudar@")) {
    setContentPaused(false);
    await sendTelegramMessage({ chatId, text: "Scheduler reanudado." });
    return { ok: true };
  }

  const waiting = jobAwaitingInput(chatId);
  if (waiting && text && !text.startsWith("/") && !message.photo && !message.document) {
    if (waiting.pendingInput === "date") {
      const iso = parsePanamaDateTime(text);
      if (!iso) {
        await sendTelegramMessage({
          chatId,
          text: "No entendí la fecha. Ejemplo: 21/08 7:00 p.m.",
        });
        return { ok: true };
      }
      updateJob(waiting.publicId, {
        recommendedPublishAt: iso,
        recommendationReason: "Fecha indicada por Telegram",
        pendingInput: null,
        status: "AWAITING_APPROVAL",
      });
      recordContentEvent(waiting.publicId, "CONTENT_RESCHEDULED", iso);
      await sendTelegramMessage({
        chatId,
        text: `Nueva hora:\n${formatPanama(iso, getContentSettings())}\n\nToca APROBAR HORARIO cuando quieras dejarla programada.`,
        keyboard: [
          [{ text: "APROBAR HORARIO", callback_data: `cs:${waiting.publicId}:slot` }],
          [{ text: "PUBLICAR AHORA", callback_data: `cs:${waiting.publicId}:now` }],
        ],
      });
      return { ok: true };
    }
    if (waiting.pendingInput === "copy") {
      updateJob(waiting.publicId, { pendingInput: null });
      if (!beginProcessLock(waiting.publicId, 60_000)) return { ok: true };
      void regenerateCopy(waiting.publicId, text).finally(() => clearProcessLock(waiting.publicId));
      return { ok: true };
    }
  }

  if (text === "/publicar" || text.startsWith("/publicar@")) {
    const existing = activeJobForChat(chatId);
    if (existing) {
      await sendTelegramMessage({
        chatId,
        text: `Ya tienes una publicación en preparación:\n\n${existing.publicId}`,
        keyboard: existingKeyboard(existing.publicId),
      });
      return { ok: true };
    }
    const job = createContentJob({ chatId, userId });
    logInfo("ContentJobCreated", { contentJobId: job.publicId });
    const sent = await sendTelegramMessage({
      chatId,
      text: [
        "🏠 HOMESTEAD CONTENT STUDIO",
        "",
        "Nueva publicación:",
        job.publicId,
        "",
        "Envíame las fotografías del trabajo realizado.",
        "",
        "Puedes enviar varias imágenes.",
        "Si quieres, escribe una nota corta. Ejemplo:",
        "Mantenimiento de aire acondicionado. No estaba enfriando.",
      ].join("\n"),
      keyboard: receivingKeyboard(job.publicId),
    });
    updateJob(job.publicId, { status: "RECEIVING", telegramStatusMessageId: sent });
    return { ok: true, publicId: job.publicId };
  }

  let job = activeJobForChat(chatId);
  const incomingPhoto = Boolean(message.photo?.length || message.document);
  if (!job && incomingPhoto) {
    job = createContentJob({ chatId, userId });
    logInfo("ContentJobCreated", { contentJobId: job.publicId, stage: "album-auto" });
    recordContentEvent(job.publicId, "CONTENT_RECEIVED", "auto");
    updateJob(job.publicId, { status: "RECEIVING" });
    job = getJobByPublicId(job.publicId) || job;
  }
  if (!job) return { ok: true };

  const caption = (message.caption || "").trim();
  const note = caption || (!message.photo && !message.document ? text : "");
  if (note && !note.startsWith("/") && (job.status === "DRAFT" || job.status === "RECEIVING")) {
    const description = [job.description, note].filter(Boolean).join("\n").slice(0, 2000);
    updateJob(job.publicId, { description, status: "RECEIVING" });
  }

  const photo = message.photo?.length
    ? message.photo.reduce((best, item) =>
        (item.file_size || 0) > (best.file_size || 0) ? item : best,
      )
    : null;
  const fileId = photo?.file_id || (message.document ? message.document.file_id : "");
  if (fileId) {
    logInfo("TelegramPhotoReceived", { contentJobId: job.publicId });
    const bytes = await downloadTelegramFile(fileId);
    if (!bytes) {
      await sendTelegramMessage({ chatId, text: "No pude descargar esa fotografía. Intenta de nuevo." });
      return { ok: true };
    }
    const sniffed = sniffImage(bytes, MAX_CONTENT_PHOTO_BYTES);
    if (!sniffed) {
      await sendTelegramMessage({
        chatId,
        text: "Solo acepto JPEG, PNG o WebP, hasta 8 MB.",
      });
      return { ok: true };
    }
    if (originalCount(job.publicId) >= MAX_CONTENT_PHOTOS) {
      await sendTelegramMessage({
        chatId,
        text: `Máximo ${MAX_CONTENT_PHOTOS} fotografías por publicación.`,
      });
      return { ok: true };
    }
    const meta = await metadataOf(bytes);
    const stored = storeOriginal({
      job,
      bytes,
      mime: sniffed.mime,
      ext: sniffed.ext,
      telegramFileId: fileId,
      width: meta.width,
      height: meta.height,
    });
    if (!stored.ok) {
      await sendTelegramMessage({ chatId, text: "No pude guardar esa fotografía." });
      return { ok: true };
    }
    logInfo("OriginalStored", { contentJobId: job.publicId, stage: stored.asset.storedFilename });
    updateJob(job.publicId, { status: "RECEIVING" });
    await remindReceiving(
      chatId,
      job.publicId,
      originalCount(job.publicId),
      job.telegramStatusMessageId,
    );
  }

  return { ok: true, publicId: job.publicId };
}
