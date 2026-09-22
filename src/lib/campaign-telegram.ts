import {
  approveCampaign,
  approvePiece,
  calendarText,
  campaignSummaryText,
  cancelCampaign,
  changeFocus,
  createDigitalLocksmithCampaign,
  editPieceCopy,
  interpretCampaignPlanIntent,
  pauseCampaign,
  recomposePieceImage,
} from "@/lib/campaign-engine";
import { campaignReport } from "@/lib/campaign-funnel";
import {
  CAMPAIGN_ID_PATTERN,
  PIECE_ID_PATTERN,
} from "@/lib/campaign-types";
import {
  getCampaignByPublicId,
  getPieceByPublicId,
  latestCampaignForChat,
  listCampaignPieces,
} from "@/lib/campaign-store";
import { getContentSettings, listAssets, readAssetBytes } from "@/lib/content-catalog";
import { sendTelegramMessage, sendTelegramPhotos, type TelegramButton } from "@/lib/content-telegram";
import { formatPanama } from "@/lib/content-queue";

function resolveCampaignId(text: string, chatId: string) {
  const match = text.toUpperCase().match(/CM-\d{4}-\d{6}/);
  if (match) return match[0];
  return latestCampaignForChat(chatId)?.publicId || "";
}

function resolvePieceId(text: string) {
  const match = text.toUpperCase().match(/CP-\d{4}-\d{6}/);
  return match?.[0] || "";
}

function campaignKeyboard(campaignId: string): TelegramButton[][] {
  return [
    [
      { text: "CALENDARIO", callback_data: `cm:${campaignId}:cal` },
      { text: "PIEZAS", callback_data: `cm:${campaignId}:pcs` },
    ],
    [
      { text: "APROBAR CAMPAÑA", callback_data: `cm:${campaignId}:ok` },
      { text: "PAUSAR", callback_data: `cm:${campaignId}:pause` },
    ],
    [
      { text: "CANCELAR", callback_data: `cm:${campaignId}:x` },
      { text: "RESULTADOS", callback_data: `cm:${campaignId}:rep` },
    ],
  ];
}

function pieceKeyboard(pieceId: string): TelegramButton[][] {
  return [
    [
      { text: "APROBAR PIEZA", callback_data: `cp:${pieceId}:ok` },
      { text: "RECOMPONER FOTO", callback_data: `cp:${pieceId}:img` },
    ],
  ];
}

async function sendCampaignBundle(chatId: string, campaignId: string) {
  const campaign = getCampaignByPublicId(campaignId);
  if (!campaign) {
    await sendTelegramMessage({ chatId, text: "No encuentro esa campaña." });
    return;
  }
  const pieces = listCampaignPieces(campaignId);
  const settings = getContentSettings();
  await sendTelegramMessage({
    chatId,
    text: campaignSummaryText(campaign, pieces),
    keyboard: campaignKeyboard(campaignId),
  });
  const photos: Array<{ bytes: Buffer; filename: string }> = [];
  for (const piece of pieces) {
    if (!piece.contentJobId) continue;
    const branded = listAssets(piece.contentJobId, "BRANDED").at(-1);
    if (!branded) continue;
    const bytes = readAssetBytes(branded);
    if (bytes) photos.push({ bytes, filename: `${piece.publicId}.jpg` });
  }
  if (photos.length) {
    await sendTelegramPhotos({ chatId, photos: photos.slice(0, 5) });
  }
  const lines = pieces.map((piece) => {
    const when = piece.scheduledAt ? formatPanama(piece.scheduledAt, settings) : piece.format;
    return `${piece.publicId} v${piece.version} · ${piece.pillar} · ${when}`;
  });
  await sendTelegramMessage({
    chatId,
    text: ["Piezas", ...lines, "", "La aprobación conjunta cubre exactamente esas versiones."].join("\n"),
  });
}

export async function handleCampaignCallback(data: string, chatId: string, userId: string) {
  if (data.startsWith("cm:")) {
    const parts = data.split(":");
    const campaignId = parts[1];
    const action = parts[2];
    if (!CAMPAIGN_ID_PATTERN.test(campaignId)) return { ok: true };
    if (action === "cal") {
      const campaign = getCampaignByPublicId(campaignId);
      const pieces = listCampaignPieces(campaignId);
      if (campaign) await sendTelegramMessage({ chatId, text: calendarText(campaign, pieces) });
      return { ok: true };
    }
    if (action === "pcs") {
      await sendCampaignBundle(chatId, campaignId);
      return { ok: true };
    }
    if (action === "ok") {
      const result = approveCampaign(campaignId, userId);
      await sendTelegramMessage({
        chatId,
        text: result.ok
          ? `Campaña aprobada y programada en simulación.\nPiezas: ${result.manifest.map((item) => `${item.id} v${item.version}`).join(", ")}.\nNo se publica en Meta mientras DRY RUN esté activo.`
          : result.reason === "unconfirmed_claims"
            ? `No puedo aprobar: hay afirmaciones sin confirmar en ${result.pieces?.join(", ")}.`
            : "No pude aprobar la campaña.",
        keyboard: result.ok ? campaignKeyboard(campaignId) : undefined,
      });
      return { ok: true };
    }
    if (action === "pause") {
      pauseCampaign(campaignId, userId);
      await sendTelegramMessage({
        chatId,
        text: "Campaña en pausa. El scheduler no publicará piezas de esta campaña. Lo ya simulado o publicado se conserva.",
      });
      return { ok: true };
    }
    if (action === "x") {
      cancelCampaign(campaignId, userId);
      await sendTelegramMessage({
        chatId,
        text: "Campaña cancelada. No borra publicaciones hechas ni el historial. Las piezas pendientes no salen.",
      });
      return { ok: true };
    }
    if (action === "rep") {
      await sendTelegramMessage({ chatId, text: formatCampaignReport(campaignId) });
      return { ok: true };
    }
  }
  if (data.startsWith("cp:")) {
    const parts = data.split(":");
    const pieceId = parts[1];
    const action = parts[2];
    if (!PIECE_ID_PATTERN.test(pieceId)) return { ok: true };
    if (action === "ok") {
      const result = approvePiece(pieceId, userId);
      await sendTelegramMessage({
        chatId,
        text: result.ok
          ? `Pieza ${pieceId} v${result.piece.version} aprobada y programada (simulación si DRY RUN).`
          : "No se pudo aprobar esa pieza.",
      });
      return { ok: true };
    }
    if (action === "img") {
      const recomposed = await recomposePieceImage(pieceId);
      if (recomposed.ok) {
        await sendTelegramPhotos({
          chatId,
          photos: [{ bytes: recomposed.bytes, filename: `${pieceId}.jpg` }],
        });
        await sendTelegramMessage({
          chatId,
          text: `Nueva composición v${recomposed.version}. La aprobación anterior ya no vale. Revísala otra vez.`,
          keyboard: pieceKeyboard(pieceId),
        });
      } else {
        await sendTelegramMessage({
          chatId,
          text: "No pude recomponer. No hay generación AI autorizada en esta campaña.",
        });
      }
      return { ok: true };
    }
  }
  return { ok: false };
}

export function formatCampaignReport(campaignId: string) {
  const report = campaignReport(campaignId);
  return [
    `Resultados ${campaignId}`,
    `Publicaciones simuladas: ${report.posts.simulated.label}`,
    `Publicaciones reales: ${report.posts.publishedReal.label}`,
    `Alcance Meta: ${report.meta.reach.label}`,
    `Reproducciones Meta: ${report.meta.plays.label}`,
    `Clics Homestead: ${report.homestead.clicks.label}`,
    `Conversaciones WhatsApp: ${report.homestead.conversations.label} (${report.homestead.conversationsNote})`,
    `Solicitudes: ${report.homestead.requests.label}`,
    `Calificadas: ${report.homestead.qualified.label} — ${report.homestead.qualifiedRule}`,
    `Contactadas: ${report.homestead.contacted.label}`,
    `Cotizaciones: ${report.homestead.quoted.label}`,
    `Citas: ${report.homestead.appointments.label}`,
    `Contratados: ${report.homestead.contracted.label}`,
    `Completados: ${report.homestead.completed.label}`,
    `Perdidas: ${report.homestead.lost.label}`,
    report.homestead.roi,
    report.conversion,
    report.meta.note,
    report.nextExperiment,
    ...report.experiments.map((item) => `${item.id}: ${item.variable} — ${item.note}`),
  ].join("\n");
}

export async function handleCampaignText(input: {
  text: string;
  chatId: string;
  userId: string;
}) {
  const text = input.text.trim();
  const lower = text.toLowerCase();
  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (command === "/campana" || command === "/campaña") {
    const rest = text.replace(/^\/campa[nñ]a(@\S+)?/i, "").trim();
    if (!rest) {
      await sendTelegramMessage({
        chatId: input.chatId,
        text: [
          "Campañas Homestead",
          "",
          "Ejemplo:",
          "Prepara una campaña de cerrajería digital para siete días. Quiero solicitudes de instalación.",
          "",
          "/calendario · /piezas · /aprobar_campana · /pausar_campana · /cancelar_campana · /resultados",
          "También: cambia el enfoque a… · edita CP-… · recomponer foto CP-…",
        ].join("\n"),
      });
      return { ok: true, handled: true };
    }
  }

  const planIntent = interpretCampaignPlanIntent(text) || (command === "/campana" || command === "/campaña" ? {
    serviceHint: "locksmith-digital",
    days: 7,
    goal: "solicitudes de instalación",
    raw: text,
  } : null);

  if (planIntent && (planIntent.serviceHint === "locksmith-digital" || command === "/campana" || command === "/campaña")) {
    if (planIntent.serviceHint === "unsupported") {
      await sendTelegramMessage({
        chatId: input.chatId,
        text: "Por ahora el motor completo está listo para cerrajería digital. Otros servicios pueden ir como pieza suelta del Content Studio, no como campaña de 5 piezas.",
      });
      return { ok: true, handled: true };
    }
    await sendTelegramMessage({
      chatId: input.chatId,
      text: "Armo la campaña piloto de cerrajería digital con 5 piezas y un guion de reel. Sin gastar OpenAI. Sin publicar a Meta.",
    });
    const created = await createDigitalLocksmithCampaign({
      chatId: input.chatId,
      userId: input.userId,
      requestedDays: planIntent.days,
    });
    if (created.reused) {
      await sendTelegramMessage({
        chatId: input.chatId,
        text: `Ya tenías ${created.campaign.publicId} abierta. La reutilizo para no duplicar generación.`,
      });
    }
    await sendCampaignBundle(input.chatId, created.campaign.publicId);
    return { ok: true, handled: true, campaignId: created.campaign.publicId };
  }

  if (command === "/calendario" || /\bcalendario (de )?(la )?campa/i.test(lower)) {
    const id = resolveCampaignId(text, input.chatId);
    const campaign = id ? getCampaignByPublicId(id) : null;
    if (!campaign) {
      await sendTelegramMessage({ chatId: input.chatId, text: "No hay una campaña abierta. Pide: Prepara una campaña de cerrajería digital…" });
      return { ok: true, handled: true };
    }
    await sendTelegramMessage({ chatId: input.chatId, text: calendarText(campaign, listCampaignPieces(campaign.publicId)) });
    return { ok: true, handled: true };
  }

  if (command === "/piezas" || /\b(ver )?piezas\b/.test(lower)) {
    const id = resolveCampaignId(text, input.chatId);
    if (id) await sendCampaignBundle(input.chatId, id);
    else await sendTelegramMessage({ chatId: input.chatId, text: "Indica la campaña (CM-…)." });
    return { ok: true, handled: true };
  }

  if (command === "/aprobar_campana" || command === "/aprobar_campaña" || /\baprueba(r)? (la )?campa/i.test(lower)) {
    const id = resolveCampaignId(text, input.chatId);
    if (!id) {
      await sendTelegramMessage({ chatId: input.chatId, text: "Indica CM-…" });
      return { ok: true, handled: true };
    }
    const result = approveCampaign(id, input.userId);
    await sendTelegramMessage({
      chatId: input.chatId,
      text: result.ok
        ? `Aprobada ${id}. Programada en simulación.\n${result.manifest.map((item) => `${item.id} v${item.version}`).join("\n")}`
        : "No pude aprobar. Revisa claims pendientes o el folio.",
    });
    return { ok: true, handled: true };
  }

  if (command === "/pausar_campana" || command === "/pausar_campaña" || /\bpausa(r)? (la )?campa/i.test(lower)) {
    const id = resolveCampaignId(text, input.chatId);
    if (id) pauseCampaign(id, input.userId);
    await sendTelegramMessage({
      chatId: input.chatId,
      text: id ? `Pausada ${id}.` : "Indica CM-…",
    });
    return { ok: true, handled: true };
  }

  if (command === "/cancelar_campana" || command === "/cancelar_campaña") {
    const id = resolveCampaignId(text, input.chatId);
    if (id) cancelCampaign(id, input.userId);
    await sendTelegramMessage({
      chatId: input.chatId,
      text: id ? `Cancelada ${id}. El historial se conserva.` : "Indica CM-…",
    });
    return { ok: true, handled: true };
  }

  if (command === "/resultados" || /\bresultados (de )?(la )?campa/i.test(lower)) {
    const id = resolveCampaignId(text, input.chatId);
    await sendTelegramMessage({
      chatId: input.chatId,
      text: id ? formatCampaignReport(id) : "Indica CM-…",
    });
    return { ok: true, handled: true };
  }

  if (/\bcambia(r)? el enfoque\b/.test(lower) || command === "/enfoque") {
    const id = resolveCampaignId(text, input.chatId);
    const focus = text.replace(/^\/enfoque(@\S+)?/i, "").replace(/.*enfoque( a)?/i, "").trim();
    if (!id) {
      await sendTelegramMessage({ chatId: input.chatId, text: "Indica la campaña." });
      return { ok: true, handled: true };
    }
    const result = changeFocus(id, focus || text);
    await sendTelegramMessage({
      chatId: input.chatId,
      text: result.ok ? result.note + "\nHay que volver a aprobar." : "No pude cambiar el enfoque.",
    });
    return { ok: true, handled: true };
  }

  if (/\bedita(r)?\b/.test(lower) && resolvePieceId(text)) {
    const pieceId = resolvePieceId(text);
    const copy = text.replace(/.*CP-\d{4}-\d{6}/i, "").replace(/^[:\-\s]+/, "").trim();
    if (!copy) {
      await sendTelegramMessage({
        chatId: input.chatId,
        text: `Escribe: edita ${pieceId}: texto nuevo de la pieza`,
      });
      return { ok: true, handled: true };
    }
    const result = editPieceCopy(pieceId, copy);
    await sendTelegramMessage({
      chatId: input.chatId,
      text: result.ok
        ? `${pieceId} ahora es v${result.piece.version}. Aprobación anterior invalidada.`
        : result.reason === "unconfirmed_claim"
          ? `No guardo ese texto: afirmación sin confirmar (${(result.hits || []).join(", ")}).`
          : "No pude editar.",
    });
    return { ok: true, handled: true };
  }

  if (/\brecompos|regenera(r)? (la )?imagen|regenera(r)? foto\b/.test(lower) && resolvePieceId(text)) {
    const pieceId = resolvePieceId(text);
    const recomposed = await recomposePieceImage(pieceId);
    if (recomposed.ok) {
      await sendTelegramPhotos({
        chatId: input.chatId,
        photos: [{ bytes: recomposed.bytes, filename: `${pieceId}.jpg` }],
      });
      await sendTelegramMessage({
        chatId: input.chatId,
        text: `Recompuesta ${pieceId} v${recomposed.version}. Hay que aprobar de nuevo. No usé OpenAI.`,
        keyboard: pieceKeyboard(pieceId),
      });
    } else {
      await sendTelegramMessage({ chatId: input.chatId, text: "No pude recomponer esa pieza." });
    }
    return { ok: true, handled: true };
  }

  return { ok: true, handled: false };
}

export function looksLikeCampaignCommand(text: string) {
  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (
    [
      "/campana",
      "/campaña",
      "/calendario",
      "/piezas",
      "/aprobar_campana",
      "/aprobar_campaña",
      "/pausar_campana",
      "/pausar_campaña",
      "/cancelar_campana",
      "/cancelar_campaña",
      "/resultados",
      "/enfoque",
    ].includes(command)
  ) {
    return true;
  }
  if (interpretCampaignPlanIntent(text)) return true;
  const lower = text.toLowerCase();
  return (
    /\bcalendario (de )?(la )?campa/.test(lower) ||
    /\baprueba(r)? (la )?campa/.test(lower) ||
    /\bpausa(r)? (la )?campa/.test(lower) ||
    /\bresultados (de )?(la )?campa/.test(lower) ||
    /\bcambia(r)? el enfoque\b/.test(lower) ||
    (/\bedita(r)?\b/.test(lower) && PIECE_ID_PATTERN.test(text.toUpperCase())) ||
    (/\brecompos|regenera/.test(lower) && PIECE_ID_PATTERN.test(text.toUpperCase())) ||
    /\b(ver )?piezas\b/.test(lower)
  );
}
