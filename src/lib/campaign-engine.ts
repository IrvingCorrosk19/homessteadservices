import { readFileSync } from "fs";
import { homesteadBrandDossier } from "@/lib/campaign-brand";
import { editorialScore, scanCommercialClaims } from "@/lib/campaign-claims";
import { campaignDestination, instagramCaptionFooter } from "@/lib/campaign-attribution";
import { digitalLocksmithPilotDrafts, similarityHits, type PieceDraft } from "@/lib/campaign-copy";
import {
  findOpenLocksmithCampaign,
  getCampaignByPublicId,
  getPieceByPublicId,
  insertCampaign,
  insertExperiment,
  insertPiece,
  listCampaignPieces,
  recordCampaignEvent,
  updateCampaign,
  updatePiece,
} from "@/lib/campaign-store";
import { planCampaignSlots } from "@/lib/campaign-planner";
import { composeCampaignFeed, publicImageAbs } from "@/lib/campaign-visual";
import { withCanonicalCta } from "@/lib/content-copy";
import {
  createContentJob,
  getContentSettings,
  getJobByPublicId,
  recordContentEvent,
  saveVersion,
  storeDerivedAsset,
  storeOriginal,
  updateJob,
} from "@/lib/content-catalog";
import { metadataOf } from "@/lib/content-images";
import type { Campaign, CampaignPiece } from "@/lib/campaign-types";

export type CampaignPlanIntent = {
  serviceHint: string;
  days: number;
  goal: string;
  raw: string;
};

export function interpretCampaignPlanIntent(text: string): CampaignPlanIntent | null {
  const raw = text.trim();
  if (!raw || raw.startsWith("/")) return null;
  const lower = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const isCampaign =
    /\b(prepara|crea|arma|planifica|quiero)\b.*\bcampana\b/.test(lower) ||
    /\bcampana\b.*\b(dias|dia|semana|cerrajer|cerradura)\b/.test(lower) ||
    /\bcampana de\b/.test(lower);
  if (!isCampaign) return null;
  const dayMatch = lower.match(/(\d+)\s*d[ií]as?/);
  const days = dayMatch ? Number(dayMatch[1]) : /\bsiete\b/.test(lower) ? 7 : 7;
  const goal = /\bsolicitud|instalaci[oó]n|clientes|leads\b/.test(lower)
    ? "solicitudes de instalación"
    : "solicitudes calificadas";
  const serviceHint = /\bcerradura digital|cerrajer[ií]a digital|digital lock\b/.test(raw)
    ? "locksmith-digital"
    : /\bcerrajer|cerradura|llave\b/.test(lower)
      ? "locksmith-digital"
      : "unsupported";
  return { serviceHint, days, goal, raw };
}

function claimsOrThrow(text: string) {
  const scan = scanCommercialClaims(text);
  if (!scan.ok) {
    throw new Error(`unconfirmed_claim:${scan.hits.join(",")}`);
  }
}

async function materializePiece(input: {
  campaign: Campaign;
  draft: PieceDraft;
  at: string | null;
  chatId: string;
  userId: string;
}) {
  const dest = campaignDestination({
    campaignId: input.campaign.publicId,
    pieceId: "CP-PENDING",
    channel: "web",
  });
  const score = editorialScore({
    hook: input.draft.hook,
    problem: input.draft.problem,
    benefit: input.draft.benefit,
    cta: input.draft.cta,
    objection: input.draft.objection,
    local: true,
    processVisible: true,
  });
  const caption = withCanonicalCta(
    [input.draft.copy, "", instagramCaptionFooter(dest.web), "", `Ref. interna al publicar.`].join("\n"),
  );
  claimsOrThrow(`${input.draft.copy}\n${input.draft.overlayText}\n${caption}`);

  const piece = insertPiece({
    campaignId: input.campaign.publicId,
    status: input.draft.publishable ? "AWAITING_APPROVAL" : "SCRIPT_READY",
    version: 1,
    approvedVersion: null,
    pillar: input.draft.pillar,
    format: input.draft.format,
    objective: input.draft.objective,
    problem: input.draft.problem,
    hook: input.draft.hook,
    benefit: input.draft.benefit,
    evidence: input.draft.evidence,
    objection: input.draft.objection,
    visualNeed: input.draft.visualNeed,
    copy: caption,
    altCopy: input.draft.altCopy,
    overlayText: input.draft.overlayText,
    cta: input.draft.cta,
    altText: input.draft.altText,
    hypothesis: input.draft.hypothesis,
    destinationUrl: dest.web,
    whatsappUrl: dest.whatsapp,
    contentJobId: "",
    scheduledAt: input.draft.publishable ? input.at : null,
    editorialScore: score.score,
  });

  const destinations = campaignDestination({
    campaignId: input.campaign.publicId,
    pieceId: piece.publicId,
    channel: "web",
  });
  const copy = caption.replace("Ref. interna al publicar.", `Ref. ${input.campaign.publicId}/${piece.publicId}`);
  updatePiece(piece.publicId, {
    destinationUrl: destinations.web,
    whatsappUrl: destinations.whatsapp,
    copy,
  });

  if (!input.draft.publishable) {
    return getPieceByPublicId(piece.publicId)!;
  }

  const job = createContentJob({ chatId: input.chatId, userId: input.userId });
  const sourceAbs = publicImageAbs(input.draft.sourceImage);
  const original = readFileSync(sourceAbs);
  const meta = await metadataOf(original);
  storeOriginal({
    job,
    bytes: original,
    mime: "image/webp",
    ext: "webp",
    width: meta.width,
    height: meta.height,
  });
  const branded = await composeCampaignFeed({
    sourceAbsPath: sourceAbs,
    overlayText: input.draft.overlayText,
    cta: input.draft.cta,
  });
  storeDerivedAsset({
    job,
    version: 1,
    assetType: "BRANDED",
    role: "PRIMARY",
    bytes: branded.bytes,
    mime: "image/jpeg",
    ext: "jpg",
    folder: "branded",
    filename: "campaign-feed.jpg",
    width: branded.width,
    height: branded.height,
  });
  saveVersion({
    job,
    version: 1,
    kind: "full",
    copy,
    cta: input.draft.cta,
    hashtags: "",
    prompt: "compose_from_stock_illustrative",
    privacyNote: input.draft.altText,
  });
  updateJob(job.publicId, {
    status: "AWAITING_APPROVAL",
    description: input.draft.hook,
    serviceType: "locksmith",
    mixType: "CAMPAIGN",
    contentType: "CAMPAIGN_FEED",
    ctaType: "QUOTE_REQUEST",
    format: "SINGLE_IMAGE",
    selectedCaption: copy,
    captionsJson: JSON.stringify([copy, input.draft.altCopy]),
    recommendedPublishAt: input.at,
    recommendationReason: "calendario de campaña",
    campaignPublicId: input.campaign.publicId,
    approvedVersion: null,
  });
  recordContentEvent(job.publicId, "CAMPAIGN_PIECE", piece.publicId);
  updatePiece(piece.publicId, { contentJobId: job.publicId });
  return getPieceByPublicId(piece.publicId)!;
}

export async function createDigitalLocksmithCampaign(input: {
  chatId: string;
  userId: string;
  requestedDays?: number;
  reuseOpen?: boolean;
  isTest?: boolean;
  now?: Date;
}) {
  if (input.reuseOpen !== false) {
    const open = findOpenLocksmithCampaign(input.chatId);
    if (open) {
      return { campaign: open, pieces: listCampaignPieces(open.publicId), reused: true as const };
    }
  }
  const dossier = homesteadBrandDossier();
  const drafts = digitalLocksmithPilotDrafts();
  const similar = similarityHits(drafts);
  if (similar.length) {
    throw new Error("piece_similarity");
  }
  const feedDrafts = drafts.filter((item) => item.publishable);
  const plan = planCampaignSlots({
    count: feedDrafts.length,
    requestedDays: input.requestedDays ?? 7,
    now: input.now,
  });
  const campaign = insertCampaign({
    status: "AWAITING_APPROVAL",
    service: "Cerrajería — cerradura digital (instalación/evaluación)",
    serviceSlug: "locksmith",
    zone: dossier.serviceArea.status === "confirmed" ? dossier.serviceArea.value : `${dossier.serviceArea.value} (cobertura detallada pendiente)`,
    audience: "Propietario o residente que quiere instalar una cerradura digital en su puerta.",
    problem: "Depender de llaves físicas o no saber si su puerta admite el cambio.",
    benefit: "Evaluación de la puerta e instalación si el cambio es viable.",
    offer: "Sin precio, descuento ni garantía publicados.",
    objections: "Compatibilidad de la puerta; no hay marca ni costo en el anuncio.",
    evidence: "Proceso publicado en el sitio. Foto de servicio ilustrativa, no un trabajo documentado.",
    conversionChannel: "Formulario web /contact (cerrajería + instalación digital). WhatsApp oficial como canal paralelo. Instagram: enlace del perfil, el caption no es clicable.",
    objective: "Solicitudes calificadas de evaluación/instalación de cerradura digital.",
    startsAt: plan.slots[0]?.at || null,
    endsAt: plan.slots.at(-1)?.at || null,
    requestedHorizonDays: input.requestedDays ?? 7,
    scheduledHorizonDays: plan.scheduledDays,
    scheduleNote: plan.note,
    maxGeneration: 0,
    generationUsed: 0,
    experimentJson: JSON.stringify({
      variable: "mensaje_principal",
      a: "comodidad (menos llaves)",
      b: "control de acceso",
      randomization: false,
    }),
    approvalManifest: "",
    telegramChatId: input.chatId,
    isTest: input.isTest ? 1 : 0,
  });
  insertExperiment({
    campaignId: campaign.publicId,
    variable: "mensaje_principal",
    variantA: "comodidad al entrar",
    variantB: "control de acceso",
    hypothesis: "La situación cotidiana de buscar la llave genera más solicitudes que hablar de control.",
  });
  const pieces: CampaignPiece[] = [];
  let feedIndex = 0;
  for (const draft of drafts) {
    const at = draft.publishable ? plan.slots[feedIndex]?.at || null : null;
    if (draft.publishable) feedIndex += 1;
    pieces.push(
      await materializePiece({
        campaign,
        draft,
        at,
        chatId: input.chatId,
        userId: input.userId,
      }),
    );
  }
  recordCampaignEvent(campaign.publicId, "CREATED", plan.note);
  return { campaign: getCampaignByPublicId(campaign.publicId)!, pieces, reused: false as const, plan };
}

export function campaignSummaryText(campaign: Campaign, pieces: CampaignPiece[]) {
  const settings = getContentSettings();
  const feed = pieces.filter((piece) => piece.format === "SINGLE_IMAGE");
  const reel = pieces.find((piece) => piece.format === "REEL_SCRIPT");
  const pending = [
    "Precios: pendiente",
    "Garantías: pendiente",
    "Testimonios autorizados: pendiente",
    "Barrios exactos: usar solo la zona confirmada",
    reel ? "Reel: guion listo, video no generado ni publicable" : "",
    "Carrusel: el publicador actual solo acepta una foto",
  ].filter(Boolean);
  return [
    `Campaña ${campaign.publicId}`,
    `Estado: ${campaign.status}`,
    `Objetivo: ${campaign.objective}`,
    `Público: ${campaign.audience}`,
    `Cobertura: ${campaign.zone}`,
    `Conversión: ${campaign.conversionChannel}`,
    "",
    campaign.scheduleNote,
    `Inicio: ${campaign.startsAt || "—"}`,
    `Fin: ${campaign.endsAt || "—"}`,
    `Piezas publicables: ${feed.length}. Guion reel: ${reel ? reel.publicId : "no"}`,
    "",
    "Plataformas previstas: Instagram + Facebook (una foto). Modo: " +
      `${settings.mode}. Simulación: ${settings.dryRun ? "sí (no sale a Meta)" : "PUBLICACIÓN REAL"}`,
    `Presupuesto de generación AI: ${campaign.maxGeneration} (usado ${campaign.generationUsed}).`,
    "",
    "Pendientes internos:",
    ...pending.map((item) => `• ${item}`),
    "",
    "Puntaje editorial: revisión interna, no predice ventas ni viralidad.",
  ].join("\n");
}

export function calendarText(campaign: Campaign, pieces: CampaignPiece[]) {
  const lines = [`Calendario ${campaign.publicId}`, campaign.scheduleNote, ""];
  for (const piece of pieces) {
    lines.push(
      `${piece.publicId} · ${piece.pillar} · ${piece.format} · v${piece.version}` +
        `${piece.approvedVersion ? ` aprobada v${piece.approvedVersion}` : ""}`,
    );
    lines.push(piece.hook);
    lines.push(piece.scheduledAt || (piece.format === "REEL_SCRIPT" ? "no entra a la cola de foto" : "sin hora"));
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function approveCampaign(campaignId: string, actor: string) {
  const campaign = getCampaignByPublicId(campaignId);
  if (!campaign) return { ok: false as const, reason: "missing" };
  const pieces = listCampaignPieces(campaignId);
  const feed = pieces.filter((piece) => piece.format === "SINGLE_IMAGE");
  const blocked = feed.filter((piece) => scanCommercialClaims(`${piece.copy}\n${piece.overlayText}`).ok === false);
  if (blocked.length) {
    return { ok: false as const, reason: "unconfirmed_claims", pieces: blocked.map((item) => item.publicId) };
  }
  const manifest = feed.map((piece) => ({ id: piece.publicId, version: piece.version, job: piece.contentJobId }));
  for (const piece of feed) {
    updatePiece(piece.publicId, { status: "APPROVED", approvedVersion: piece.version });
    if (piece.contentJobId) {
      updateJob(piece.contentJobId, {
        status: "SCHEDULED",
        approvedAt: new Date().toISOString(),
        approvedVersion: piece.version,
      });
    }
  }
  updateCampaign(campaignId, {
    status: "SCHEDULED",
    approvalManifest: JSON.stringify({ actor, at: new Date().toISOString(), pieces: manifest }),
  });
  recordCampaignEvent(campaignId, "APPROVED", actor);
  return { ok: true as const, manifest, campaign: getCampaignByPublicId(campaignId)! };
}

export function approvePiece(pieceId: string, actor: string) {
  const piece = getPieceByPublicId(pieceId);
  if (!piece) return { ok: false as const, reason: "missing" };
  if (piece.format !== "SINGLE_IMAGE") {
    return { ok: false as const, reason: "not_publishable" };
  }
  updatePiece(pieceId, { status: "APPROVED", approvedVersion: piece.version });
  if (piece.contentJobId) {
    updateJob(piece.contentJobId, {
      status: "SCHEDULED",
      approvedAt: new Date().toISOString(),
      approvedVersion: piece.version,
    });
  }
  recordCampaignEvent(piece.campaignId, "PIECE_APPROVED", actor, pieceId);
  return { ok: true as const, piece: getPieceByPublicId(pieceId)! };
}

export function editPieceCopy(pieceId: string, copy: string) {
  const piece = getPieceByPublicId(pieceId);
  if (!piece) return { ok: false as const, reason: "missing" };
  const scan = scanCommercialClaims(copy);
  if (!scan.ok) return { ok: false as const, reason: "unconfirmed_claim", hits: scan.hits };
  const nextVersion = piece.version + 1;
  updatePiece(pieceId, {
    copy,
    version: nextVersion,
    approvedVersion: piece.approvedVersion,
    status: "AWAITING_APPROVAL",
  });
  if (piece.contentJobId) {
    updateJob(piece.contentJobId, {
      selectedCaption: copy,
      status: "AWAITING_APPROVAL",
      approvedVersion: null,
    });
  }
  const campaign = getCampaignByPublicId(piece.campaignId);
  if (campaign && (campaign.status === "APPROVED" || campaign.status === "SCHEDULED")) {
    updateCampaign(piece.campaignId, { status: "AWAITING_APPROVAL", approvalManifest: "" });
  }
  recordCampaignEvent(piece.campaignId, "PIECE_EDITED", `v${nextVersion}`, pieceId);
  return { ok: true as const, piece: getPieceByPublicId(pieceId)!, invalidated: true as const };
}

export function pauseCampaign(campaignId: string, actor: string) {
  const campaign = getCampaignByPublicId(campaignId);
  if (!campaign) return { ok: false as const, reason: "missing" };
  updateCampaign(campaignId, { status: "PAUSED" });
  recordCampaignEvent(campaignId, "PAUSED", actor);
  return { ok: true as const, campaign: getCampaignByPublicId(campaignId)! };
}

export function cancelCampaign(campaignId: string, actor: string) {
  const campaign = getCampaignByPublicId(campaignId);
  if (!campaign) return { ok: false as const, reason: "missing" };
  const pieces = listCampaignPieces(campaignId);
  for (const piece of pieces) {
    if (piece.format === "REEL_SCRIPT") {
      updatePiece(piece.publicId, { status: "CANCELLED" });
      continue;
    }
    const job = piece.contentJobId ? getJobByPublicId(piece.contentJobId) : null;
    if (job && (job.status === "PUBLISHED" || job.status === "SIMULATED")) {
      continue;
    }
    updatePiece(piece.publicId, { status: "CANCELLED" });
    if (job && job.status !== "PUBLISHED" && job.status !== "SIMULATED") {
      updateJob(job.publicId, { status: "CANCELLED" });
    }
  }
  updateCampaign(campaignId, { status: "CANCELLED" });
  recordCampaignEvent(campaignId, "CANCELLED", actor);
  return { ok: true as const, campaign: getCampaignByPublicId(campaignId)! };
}

export function changeFocus(campaignId: string, focus: string) {
  const campaign = getCampaignByPublicId(campaignId);
  if (!campaign) return { ok: false as const, reason: "missing" };
  const pieces = listCampaignPieces(campaignId).filter((piece) => piece.format === "SINGLE_IMAGE");
  const first = pieces[0];
  if (!first) return { ok: false as const, reason: "no_pieces" };
  const note = `Enfoque pedido: ${focus.slice(0, 180)}. Se ajusta la hipótesis de la primera pieza; no se cambian precios ni zonas.`;
  updatePiece(first.publicId, {
    hypothesis: `${first.hypothesis} | ${note}`,
    version: first.version + 1,
    status: "AWAITING_APPROVAL",
  });
  if (first.contentJobId) {
    updateJob(first.contentJobId, { status: "AWAITING_APPROVAL", approvedVersion: null });
  }
  updateCampaign(campaignId, { status: "AWAITING_APPROVAL", approvalManifest: "" });
  recordCampaignEvent(campaignId, "FOCUS", note, first.publicId);
  return { ok: true as const, note, pieceId: first.publicId };
}

export function regeneratePieceImage(pieceId: string) {
  const piece = getPieceByPublicId(pieceId);
  if (!piece) return { ok: false as const, reason: "missing" };
  const campaign = getCampaignByPublicId(piece.campaignId);
  if (!campaign) return { ok: false as const, reason: "missing_campaign" };
  if (campaign.generationUsed >= campaign.maxGeneration) {
    return {
      ok: false as const,
      reason: "budget",
      message:
        "El presupuesto de generación AI de esta campaña es 0. Recomponemos sobre la foto ilustrativa existente, sin OpenAI. Para imágenes nuevas hace falta un límite autorizado y créditos.",
    };
  }
  return { ok: false as const, reason: "budget" };
}

export async function recomposePieceImage(pieceId: string) {
  const piece = getPieceByPublicId(pieceId);
  if (!piece?.contentJobId) return { ok: false as const, reason: "missing" };
  const job = getJobByPublicId(piece.contentJobId);
  if (!job) return { ok: false as const, reason: "missing_job" };
  const sourceAbs = publicImageAbs("/images/services/locksmith.webp");
  const branded = await composeCampaignFeed({
    sourceAbsPath: sourceAbs,
    overlayText: piece.overlayText,
    cta: piece.cta,
  });
  const nextVersion = piece.version + 1;
  storeDerivedAsset({
    job,
    version: nextVersion,
    assetType: "BRANDED",
    role: "PRIMARY",
    bytes: branded.bytes,
    mime: "image/jpeg",
    ext: "jpg",
    folder: "branded",
    filename: `campaign-feed-v${nextVersion}.jpg`,
    width: branded.width,
    height: branded.height,
  });
  updatePiece(pieceId, {
    version: nextVersion,
    status: "AWAITING_APPROVAL",
  });
  updateJob(job.publicId, { status: "AWAITING_APPROVAL", approvedVersion: null });
  updateCampaign(piece.campaignId, { status: "AWAITING_APPROVAL", approvalManifest: "" });
  recordCampaignEvent(piece.campaignId, "IMAGE_RECOMPOSED", `v${nextVersion}`, pieceId);
  return { ok: true as const, version: nextVersion, bytes: branded.bytes };
}
