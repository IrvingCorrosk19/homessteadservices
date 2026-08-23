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
  tryApproveContentJob,
  tryRejectContentJob,
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
  isPrivateTelegramChat,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/content-telegram";
import {
  accessDeniedText,
  displayNameFromTelegram,
  gateOperator,
  handleStartCommand,
} from "@/lib/telegram-operator-flow";
import {
  actorLabel,
  hasTelegramPermission,
  incrementTelegramMetric,
  recordTelegramOperatorAudit,
  type TelegramOperator,
} from "@/lib/telegram-operators";
import {
  formatRecommendationMessage,
  recommendationKeyboard,
  runMarketingEngine,
  marketingBaseline,
} from "@/lib/marketing-engine";
import { latestRecommendation, recordLead, hisForPublicId, markRecommendationDecision } from "@/lib/marketing-store";
import { mapServiceCategory } from "@/lib/marketing-config";
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

function studioEnabled() {
  return Boolean(process.env.CONTENT_STUDIO_ENABLED) && process.env.CONTENT_STUDIO_ENABLED !== "false";
}

function isOpsCommand(text: string) {
  const command = text.split("@")[0].toLowerCase();
  return ["/homestead", "/hoy", "/leads", "/calientes", "/agenda", "/trabajos"].includes(command);
}

function hasContentPermission(operator: TelegramOperator, callbackData: string) {
  if (
    callbackData.includes(":approve") ||
    callbackData.includes(":reject") ||
    callbackData.includes(":slot") ||
    callbackData.includes(":now")
  ) {
    return hasTelegramPermission(operator, "content.approve");
  }
  return hasTelegramPermission(operator, "content.read");
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (seenTelegramUpdate(update.update_id)) {
    return { ok: true, duplicate: true };
  }

  const callback = update.callback_query;
  if (callback?.data) {
    const chatId = String(callback.message?.chat.id || callback.from.id);
    const userId = String(callback.from.id);
    const chatType = callback.message?.chat.type;
    if (!isPrivateTelegramChat(chatType)) {
      await answerCallback(callback.id, "Solo chat privado");
      return { ok: true, denied: true, reason: "group" };
    }
    const gate = gateOperator(userId, chatId);
    if (!gate.ok) {
      logError("ContentStudioUnauthorized", { stage: "callback", contentJobId: chatId.slice(0, 24) });
      incrementTelegramMetric("telegram_permission_denied");
      await answerCallback(callback.id, "No autorizado");
      if (gate.reason === "unauthorized" || gate.reason === "pending" || gate.reason === "inactive") {
        await sendTelegramMessage({ chatId, text: accessDeniedText(gate.reason) });
      }
      return { ok: true, denied: true };
    }
    const operator = gate.operator!;
    await answerCallback(callback.id);
    if (callback.data.startsWith("cc:")) {
      const { applyCommandCenterCallback } = await import("@/lib/ops-telegram");
      await applyCommandCenterCallback(callback.data, chatId, callback.message?.message_id, operator);
      return { ok: true };
    }
    if (callback.data.startsWith("rv:")) {
      if (!gateOperator(userId, chatId, "appointments.manage").ok && !gateOperator(userId, chatId, "leads.manage").ok) {
        await sendTelegramMessage({ chatId, text: accessDeniedText("forbidden") });
        return { ok: true, denied: true };
      }
      const { applyRevenueCallback } = await import("@/lib/revenue-telegram");
      const result = await applyRevenueCallback(callback.data, chatId);
      await sendTelegramMessage({ chatId, text: result.text, keyboard: result.keyboard });
      return { ok: true };
    }
    if (!studioEnabled()) {
      return { ok: true, skipped: "disabled" };
    }
    if (!hasContentPermission(operator, callback.data)) {
      await sendTelegramMessage({ chatId, text: accessDeniedText("forbidden") });
      return { ok: true, denied: true };
    }
    if (callback.data.startsWith("mi:")) {
      const bits = callback.data.split(":");
      const action = bits[1];
      const recId = bits[2] || "";
      markRecommendationDecision(recId, action === "nopost" ? "NO_POST" : action === "approve" ? "APPROVED_SHADOW" : "SKIP");
      await sendTelegramMessage({
        chatId,
        text:
          action === "nopost"
            ? "Registrado: no publicar hoy. En SHADOW no se mueve la cola."
            : action === "approve"
              ? "Shadow: guardé tu aprobación. No moví la programación. Si quieres programarla de verdad, abre la pieza y toca APROBAR HORARIO."
              : "Buscaré otro contenido en la próxima /recomendar.",
      });
      return { ok: true };
    }
    const parsed = parseCallback(callback.data);
    if (!parsed) return { ok: true };
    const job = getJobByPublicId(parsed.publicId);
    if (!job) return { ok: true };
    const actor = actorLabel(operator);
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
      const result = tryApproveContentJob(job.publicId, actor);
      if (result.already) {
        incrementTelegramMetric("telegram_stale_callback");
        recordTelegramOperatorAudit({
          operator,
          action: "CONTENT_APPROVE",
          entityType: "content",
          entityId: job.publicId,
          result: "already",
        });
        await sendTelegramMessage({
          chatId,
          text: "Este contenido ya fue aprobado.",
        });
        return { ok: true };
      }
      if (!result.ok) {
        incrementTelegramMetric("telegram_stale_callback");
        await sendTelegramMessage({
          chatId,
          text:
            result.reason === "stale"
              ? "Esta acción ya no está disponible porque el estado cambió."
              : "Esta propuesta todavía no está lista para aprobar.",
        });
        return { ok: true };
      }
      logInfo("ContentApproved", { contentJobId: job.publicId });
      recordTelegramOperatorAudit({
        operator,
        action: "CONTENT_APPROVE",
        entityType: "content",
        entityId: job.publicId,
        result: "ok",
      });
      await sendTelegramMessage({
        chatId,
        text: [
          "✅ CONTENIDO APROBADO",
          "",
          job.publicId,
          "",
          `Aprobado por: ${operator.displayName}`,
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
      const result = tryRejectContentJob(job.publicId, actor);
      if (result.already) {
        incrementTelegramMetric("telegram_stale_callback");
        await sendTelegramMessage({
          chatId,
          text: "Este contenido ya fue descartado.",
        });
        return { ok: true };
      }
      if (!result.ok) {
        incrementTelegramMetric("telegram_stale_callback");
        await sendTelegramMessage({
          chatId,
          text: "Esta acción ya no está disponible porque el estado cambió.",
        });
        return { ok: true };
      }
      logInfo("ContentRejected", { contentJobId: job.publicId });
      recordTelegramOperatorAudit({
        operator,
        action: "CONTENT_REJECT",
        entityType: "content",
        entityId: job.publicId,
        result: "ok",
      });
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
  const chatType = message.chat.type;
  if (!isPrivateTelegramChat(chatType)) {
    if (text === "/start" || text.startsWith("/start@") || isOpsCommand(text) || text === "/homestead" || text.startsWith("/homestead@")) {
      await sendTelegramMessage({ chatId, text: accessDeniedText("group") });
    }
    return { ok: true, denied: true, reason: "group" };
  }

  if (text === "/start" || text.startsWith("/start@")) {
    await handleStartCommand({
      userId,
      chatId,
      displayName: displayNameFromTelegram(message.from),
    });
    return { ok: true };
  }

  const gate = gateOperator(userId, chatId);
  if (!gate.ok) {
    logError("ContentStudioUnauthorized", { stage: "message", contentJobId: chatId.slice(0, 24) });
    if (isOpsCommand(text) || text === "/publicar" || text.startsWith("/publicar@") || text === "/homestead" || text.startsWith("/homestead@")) {
      await sendTelegramMessage({ chatId, text: accessDeniedText(gate.reason) });
    }
    return { ok: true, denied: true };
  }
  const operator = gate.operator!;

  if (text && !text.startsWith("/")) {
    const { consumeOperatorDate } = await import("@/lib/revenue-telegram");
    const consumed = await consumeOperatorDate(chatId, text);
    if (consumed) {
      await sendTelegramMessage({ chatId, text: consumed.text, keyboard: consumed.keyboard });
      return { ok: true };
    }
  }

  const nl = text.toLowerCase();
  if (text === "/homestead" || text.startsWith("/homestead@")) {
    const { sendCommandCenter } = await import("@/lib/ops-telegram");
    await sendCommandCenter(chatId, false, operator);
    return { ok: true };
  }
  if (
    nl.includes("qué tengo pendiente") ||
    nl.includes("que tengo pendiente") ||
    nl === "qué hago hoy?" ||
    nl === "¿qué hago hoy?" ||
    nl.includes("qué debo hacer ahora")
  ) {
    const { sendCommandCenter } = await import("@/lib/ops-telegram");
    await sendCommandCenter(chatId);
    return { ok: true };
  }
  if (text === "/hoy" || text.startsWith("/hoy@")) {
    const { agendaView } = await import("@/lib/ops-telegram");
    const view = agendaView(0, false);
    await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
    return { ok: true };
  }
  if (text === "/leads" || text.startsWith("/leads@") || text === "/calientes" || text.startsWith("/calientes@")) {
    const { rescueView } = await import("@/lib/ops-telegram");
    const view = rescueView(0, false);
    await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
    return { ok: true };
  }
  if (nl.includes("a quién debo llamar") || nl.includes("a quien contacto")) {
    const { rescueView } = await import("@/lib/ops-telegram");
    const view = rescueView(0, false);
    await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
    return { ok: true };
  }
  if (text === "/agenda" || text.startsWith("/agenda@")) {
    const { agendaView } = await import("@/lib/ops-telegram");
    const view = agendaView(0, false);
    await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
    return { ok: true };
  }
  if (text === "/trabajos" || text.startsWith("/trabajos@")) {
    const { jobsView } = await import("@/lib/ops-telegram");
    const view = jobsView(0, false);
    await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
    return { ok: true };
  }

  const { getOperatorPending } = await import("@/lib/revenue-store");
  const pendingPhotos = getOperatorPending(chatId);
  if (pendingPhotos?.expect === "job_photos") {
    const incomingPhoto = Boolean(message.photo?.length || message.document);
    if (incomingPhoto) {
      const photo = message.photo?.length
        ? message.photo.reduce((best, item) => ((item.file_size || 0) > (best.file_size || 0) ? item : best))
        : null;
      const fileId = photo?.file_id || (message.document ? message.document.file_id : "");
      const bytes = fileId ? await downloadTelegramFile(fileId) : null;
      if (!bytes) {
        await sendTelegramMessage({ chatId, text: "No pude descargar esa fotografía. Intenta de nuevo." });
        return { ok: true };
      }
      const sniffed = sniffImage(bytes, MAX_CONTENT_PHOTO_BYTES);
      if (!sniffed) {
        await sendTelegramMessage({ chatId, text: "Solo acepto JPEG, PNG o WebP, hasta 8 MB." });
        return { ok: true };
      }
      const { storeJobOriginal, jobPhotoCount } = await import("@/lib/job-photos");
      const stored = storeJobOriginal({ jobId: pendingPhotos.lead_id, bytes, sniffed, actor: userId });
      if (!stored.ok) {
        await sendTelegramMessage({
          chatId,
          text: stored.error === "too_many" ? "Ya hay suficientes fotos en este trabajo." : "No pude guardar esa fotografía.",
        });
        return { ok: true };
      }
      const count = jobPhotoCount(pendingPhotos.lead_id);
      await sendTelegramMessage({
        chatId,
        text: stored.duplicate
          ? `Esa foto ya estaba guardada.\n\n${pendingPhotos.lead_id}\n${count} originales.`
          : `📸 Foto del trabajo guardada (${count})\n\n${pendingPhotos.lead_id}\nOriginal intacto. Puedes enviar más.`,
      });
      return { ok: true };
    }
  }
  if (!studioEnabled()) {
    return { ok: true, skipped: "disabled" };
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
        `Marketing: SHADOW ${process.env.MARKETING_INTELLIGENCE_SHADOW === "false" ? "no" : "sí"} · /recomendar`,
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

  if (text === "/seguimientos" || text.startsWith("/seguimientos@")) {
    const { formatFollowups } = await import("@/lib/revenue-telegram");
    await sendTelegramMessage({ chatId, text: formatFollowups() });
    return { ok: true };
  }
  if (text === "/cotizaciones" || text.startsWith("/cotizaciones@") || nl.includes("cotizaciones están")) {
    const { formatQuotes } = await import("@/lib/revenue-telegram");
    await sendTelegramMessage({ chatId, text: formatQuotes() });
    return { ok: true };
  }
  if (text === "/clientes" || text.startsWith("/clientes@")) {
    const { customerSearchPrompt } = await import("@/lib/ops-telegram");
    const { hasTelegramPermission } = await import("@/lib/telegram-operators");
    if (!hasTelegramPermission(operator, "customers.read")) {
      await sendTelegramMessage({ chatId, text: "No autorizado para clientes." });
      return { ok: true };
    }
    const view = customerSearchPrompt();
    await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
    return { ok: true };
  }
  if (text.startsWith("/cliente ") || text.startsWith("/cliente@")) {
    const { hasTelegramPermission } = await import("@/lib/telegram-operators");
    if (!hasTelegramPermission(operator, "customers.read")) {
      await sendTelegramMessage({ chatId, text: "No autorizado para clientes." });
      return { ok: true };
    }
    const query = text.replace(/^\/cliente(@\S+)?\s+/i, "").trim();
    const { customerSearchResults } = await import("@/lib/ops-telegram");
    const view = customerSearchResults(query || "");
    await sendTelegramMessage({ chatId, text: view.text, keyboard: view.keyboard });
    return { ok: true };
  }
  if (text === "/reseñas" || text.startsWith("/reseñas@") || text === "/resenas" || text.startsWith("/resenas@")) {
    const { revenueSnapshot } = await import("@/lib/revenue-store");
    await sendTelegramMessage({
      chatId,
      text: `Reseñas elegibles: ${revenueSnapshot().reviews}\nNo hay URL de Google/Facebook configurada: no se inventa el enlace.`,
    });
    return { ok: true };
  }
  if (text === "/mantenimientos" || text.startsWith("/mantenimientos@")) {
    const { revenueSnapshot } = await import("@/lib/revenue-store");
    await sendTelegramMessage({
      chatId,
      text: `Oportunidades de mantenimiento: ${revenueSnapshot().maintenance}\nIntervalo A/C configurado: 90 días (comercial, no se contacta al cliente en AUTO).`,
    });
    return { ok: true };
  }
  if (text === "/ventas" || text.startsWith("/ventas@") || nl.includes("cuánto hemos vendido") || nl.includes("cuanto hemos vendido") || nl.includes("de dónde vienen")) {
    const { formatVentas } = await import("@/lib/revenue-telegram");
    await sendTelegramMessage({ chatId, text: formatVentas() });
    return { ok: true };
  }

  if (text === "/recomendar" || text.startsWith("/recomendar@") || text === "¿Qué publico hoy?" || text === "¿A qué hora publico?") {
    const decision = runMarketingEngine();
    await sendTelegramMessage({
      chatId,
      text: formatRecommendationMessage(decision),
      keyboard: recommendationKeyboard(decision),
    });
    return { ok: true };
  }
  if (text === "/porque" || text.startsWith("/porque@")) {
    const rec = latestRecommendation();
    await sendTelegramMessage({
      chatId,
      text: rec
        ? `${rec.reason}\n\nCódigos: ${rec.reasonCodes.join(", ")}\nMuestra: ${rec.sampleSize}\nConfianza: ${rec.confidence}`
        : "Todavía no hay una recomendación. Usa /recomendar.",
    });
    return { ok: true };
  }
  if (text === "/aprendizaje" || text.startsWith("/aprendizaje@")) {
    const base = marketingBaseline();
    await sendTelegramMessage({
      chatId,
      text: [
        `Modo: ${base.learningStage}${base.shadow ? " · SHADOW" : ""}`,
        `Listos: ${base.ready}`,
        `Programados: ${base.scheduled}`,
        `Publicados: ${base.published}`,
        `Con analytics: ${base.withAnalytics}`,
        base.withAnalytics < 1 ? "INSUFFICIENT DATA — no hay horario 'mejor' todavía." : "",
        base.queueLow ? "Quedan pocas piezas listas. Conviene registrar nuevos trabajos." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { ok: true };
  }
  if (text === "/rendimiento" || text.startsWith("/rendimiento@")) {
    const base = marketingBaseline();
    const rec = latestRecommendation();
    await sendTelegramMessage({
      chatId,
      text: [
        "Últimos datos Homestead",
        `Publicaciones registradas: ${base.published}`,
        `Con métricas de red: ${base.withAnalytics}`,
        base.withAnalytics < 1
          ? "Alcance y likes: NOT AVAILABLE (Instagram/Facebook no configurados)."
          : "",
        `Contactos atribuibles: usa /lead para registrarlos.`,
        rec ? `Siguiente evidencia: ${rec.publicId}` : "Sin recomendación vigente.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { ok: true };
  }
  if (text === "/horarios" || text.startsWith("/horarios@")) {
    await sendTelegramMessage({
      chatId,
      text: [
        "Ventanas (estrategia inicial, America/Panama):",
        "1. 18:00–21:00 — evening (sampleSize 0 → INSUFFICIENT DATA)",
        "2. 15:00–18:00 — afternoon",
        "3. 09:00–12:00 — late morning",
        "",
        "No hay evidencia propia de 'mejor hora' hasta recolectar analytics reales.",
      ].join("\n"),
    });
    return { ok: true };
  }
  if (text === "/servicios" || text.startsWith("/servicios@")) {
    const published = listJobsByStatus(["PUBLISHED", "AWAITING_APPROVAL", "SCHEDULED"]);
    const counts = new Map<string, number>();
    for (const job of published) {
      const cat = mapServiceCategory(job.serviceType);
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    const lines = [...counts.entries()].map(([cat, n]) => `${cat}: ${n} (sin Intent Score de red todavía)`);
    await sendTelegramMessage({
      chatId,
      text: lines.length
        ? `Inventario por servicio:\n\n${lines.join("\n")}`
        : "INSUFFICIENT DATA — aún no hay categorías con intención medida.",
    });
    return { ok: true };
  }
  if (text === "/mejores" || text.startsWith("/mejores@")) {
    const published = listJobsByStatus(["PUBLISHED"]);
    const ranked = published
      .map((job) => ({ job, his: hisForPublicId(job.publicId) }))
      .filter((row) => row.his.score !== null)
      .sort((a, b) => (b.his.score || 0) - (a.his.score || 0));
    await sendTelegramMessage({
      chatId,
      text: ranked.length
        ? ranked
            .slice(0, 5)
            .map((row) => `${row.job.publicId} · HIS ${row.his.score}`)
            .join("\n")
        : "INSUFFICIENT DATA — no hay Intent Score todavía (sin métricas ni /lead).",
    });
    return { ok: true };
  }
  if (text.startsWith("/lead")) {
    const parts = text.split(/\s+/);
    const folio = parts[1] || "";
    const outcomeRaw = (parts[2] || "UNKNOWN").toLowerCase();
    const outcome =
      outcomeRaw === "si" || outcomeRaw === "sí"
        ? "QUALIFIED_LEAD"
        : outcomeRaw === "no"
          ? "CONTACT"
          : "UNKNOWN";
    if (!/^HC-\d{4}-\d{6}$/.test(folio)) {
      await sendTelegramMessage({
        chatId,
        text: "Uso: /lead HC-2026-000005 si\n(si = oportunidad, no = contacto, otro = no sé)",
      });
      return { ok: true };
    }
    recordLead({ publicId: folio, channel: "telegram", outcome });
    await sendTelegramMessage({ chatId, text: `Lead registrado para ${folio} (${outcome}). Sin datos personales.` });
    return { ok: true };
  }
  if (text.startsWith("/prioridad")) {
    const folio = text.split(/\s+/)[1] || "";
    if (!/^HC-\d{4}-\d{6}$/.test(folio)) {
      await sendTelegramMessage({ chatId, text: "Uso: /prioridad HC-2026-000005" });
      return { ok: true };
    }
    updateJob(folio, { businessPriority: 1 });
    await sendTelegramMessage({ chatId, text: `Prioridad alta en ${folio}.` });
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
