import {
  getContentSettings,
  listJobsByStatus,
  recordContentEvent,
} from "@/lib/content-catalog";
import type { ContentJob } from "@/lib/content-types";
import {
  confidenceFromSample,
  isMarketingShadow,
  learningStage,
  mapServiceCategory,
  marketingConfig,
} from "@/lib/marketing-config";
import { hisForPublicId, saveRecommendation, snapshotCount } from "@/lib/marketing-store";
import { formatPanama, recommendPublishAt } from "@/lib/content-queue";

export type EngineDecision = {
  kind: "recommend" | "no_post";
  publicId?: string;
  recommendedAt?: string | null;
  platform: string;
  score: number;
  confidence: string;
  learningStage: string;
  reasonCodes: string[];
  sampleSize: number;
  reason: string;
  shadow: boolean;
  recommendationId?: string;
};

export function explainCodes(codes: string[], sampleSize: number, stage: string) {
  if (codes.includes("INSUFFICIENT_DATA") || stage === "STAGE_0_COLD_START") {
    return "Estamos aprendiendo qué horarios funcionan mejor. Esta recomendación forma parte de la etapa inicial de aprendizaje.";
  }
  const parts: string[] = [];
  if (codes.includes("HIGH_INTENT_WINDOW")) {
    parts.push("contenidos similares han generado más intención comercial en esa franja");
  }
  if (codes.includes("CONTENT_DIVERSITY")) {
    parts.push("evita repetir el mismo servicio seguido");
  }
  if (codes.includes("HIGH_PRIORITY")) {
    parts.push("marcaste este contenido como prioridad alta");
  }
  if (codes.includes("EXPLORATION_SLOT")) {
    parts.push("probamos una ventana distinta para aprender");
  }
  if (codes.includes("FRESH_CONTENT")) {
    parts.push("el trabajo es reciente");
  }
  if (codes.includes("DAILY_LIMIT")) {
    return "Hoy ya alcanzamos el límite de publicaciones orgánicas configurado.";
  }
  if (codes.includes("PREVIOUS_POST_STILL_PERFORMING")) {
    return "La publicación anterior todavía muestra buen rendimiento. Conviene esperar.";
  }
  const body = parts.length ? parts.join("; ") : "estrategia inicial y calendario disponible";
  return `Te lo recomiendo porque ${body}. La muestra es de ${sampleSize} publicación(es) comparable(s).`;
}

function candidateScore(job: ContentJob, recentCategories: string[]) {
  const codes: string[] = [];
  let score = 40;
  const category = mapServiceCategory(job.serviceType);
  const his = hisForPublicId(job.publicId);
  if (his.score !== null) {
    score += Math.min(30, his.score / 5);
    codes.push("SERVICE_PERFORMANCE");
  }
  const repeats = recentCategories.filter((item) => item === category).length;
  if (repeats >= 2) {
    score -= marketingConfig.diversityPenalty;
    codes.push("CONTENT_DIVERSITY");
  }
  if (job.businessPriority > 0) {
    score += marketingConfig.priorityBoost * job.businessPriority;
    codes.push("HIGH_PRIORITY");
  }
  const ageDays = (Date.now() - Date.parse(job.createdAt)) / 86400000;
  if (ageDays <= 14) {
    score += 8;
    codes.push("FRESH_CONTENT");
  }
  if (job.validUntil && Date.parse(job.validUntil) < Date.now()) {
    score -= 100;
    codes.push("EXPIRED");
  }
  return { score, codes, category, his };
}

export function runMarketingEngine(): EngineDecision {
  const shadow = isMarketingShadow();
  const settings = getContentSettings();
  const evidenceN = snapshotCount();
  const stage = learningStage(evidenceN);
  const sampleSize = evidenceN;
  const confidence = stage === "STAGE_0_COLD_START" ? "LOW" : confidenceFromSample(sampleSize);
  const published = listJobsByStatus(["PUBLISHED", "SCHEDULED"]);
  const recentCategories = published
    .slice(0, marketingConfig.diversityLookback)
    .map((job) => mapServiceCategory(job.serviceType));
  const todayStamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayCount = published.filter((job) => {
    const at = job.recommendedPublishAt || job.approvedAt;
    if (!at) return false;
    return (
      new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(at)) === todayStamp
    );
  }).length;
  if (todayCount >= marketingConfig.maxOrganicPostsPerDay) {
    return {
      kind: "no_post",
      platform: "instagram,facebook",
      score: 0,
      confidence,
      learningStage: stage,
      reasonCodes: ["DAILY_LIMIT"],
      sampleSize,
      reason: explainCodes(["DAILY_LIMIT"], sampleSize, stage),
      shadow,
    };
  }

  const eligible = listJobsByStatus(["AWAITING_APPROVAL", "READY_FOR_REVIEW", "APPROVED"]).filter(
    (job) => !job.validUntil || Date.parse(job.validUntil) > Date.now(),
  );
  if (!eligible.length) {
    return {
      kind: "no_post",
      platform: "instagram,facebook",
      score: 0,
      confidence,
      learningStage: stage,
      reasonCodes: ["INSUFFICIENT_DATA"],
      sampleSize,
      reason: "No hay contenidos listos para recomendar. Conviene registrar nuevos trabajos.",
      shadow,
    };
  }

  const explore = stage !== "STAGE_3_OPTIMIZED" && Math.random() < marketingConfig.explorationRate;
  const ranked = eligible
    .map((job) => ({ job, ...candidateScore(job, recentCategories) }))
    .sort((a, b) => b.score - a.score);
  const picked = explore && ranked.length > 1 ? ranked[Math.min(ranked.length - 1, 1)] : ranked[0];
  const slot = recommendPublishAt(picked.job, settings);
  const codes = [...picked.codes];
  if (explore) codes.push("EXPLORATION_SLOT");
  if (sampleSize < marketingConfig.minSamples.medium) codes.push("INSUFFICIENT_DATA");
  else codes.push("HIGH_INTENT_WINDOW");
  const reason = explainCodes(codes, sampleSize, stage);
  const saved = saveRecommendation({
    publicId: picked.job.publicId,
    recommendedAt: slot.at,
    platform: "instagram,facebook",
    score: picked.score,
    confidence,
    learningStage: stage,
    reasonCodes: codes,
    sampleSize,
    reason,
    shadow,
  });
  recordContentEvent(picked.job.publicId, "CONTENT_RECOMMENDED", saved.recommendationId);
  return {
    kind: "recommend",
    publicId: picked.job.publicId,
    recommendedAt: slot.at,
    platform: "instagram,facebook",
    score: picked.score,
    confidence,
    learningStage: stage,
    reasonCodes: codes,
    sampleSize,
    reason,
    shadow,
    recommendationId: saved.recommendationId,
  };
}

export function marketingBaseline() {
  const ready = listJobsByStatus(["AWAITING_APPROVAL", "READY_FOR_REVIEW"]).length;
  const scheduled = listJobsByStatus(["SCHEDULED"]).length;
  const published = listJobsByStatus(["PUBLISHED"]).length;
  const evidence = snapshotCount();
  return {
    ready,
    scheduled,
    published,
    withAnalytics: evidence,
    learningStage: learningStage(evidence),
    shadow: isMarketingShadow(),
    queueLow: ready < marketingConfig.queueHealthMinReady,
  };
}

export function formatRecommendationMessage(decision: EngineDecision) {
  const settings = getContentSettings();
  if (decision.kind === "no_post") {
    return [
      "HOMESTEAD · RECOMENDACIÓN",
      "",
      "NO PUBLICAR AHORA",
      "",
      decision.reason,
      "",
      `Confianza: ${decision.confidence}`,
      `Etapa: ${decision.learningStage}`,
      decision.shadow ? "Modo: SHADOW (no cambia la programación)" : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const when = decision.recommendedAt ? formatPanama(decision.recommendedAt, settings) : "por definir";
  return [
    "HOMESTEAD · RECOMENDACIÓN",
    "",
    `Contenido: ${decision.publicId}`,
    "Plataforma: Instagram + Facebook",
    `Hora recomendada: ${when}`,
    "Objetivo: generar consultas",
    `Confianza: ${decision.confidence}`,
    "",
    decision.reason,
    "",
    `Datos: ${decision.sampleSize} publicación(es) con evidencia.`,
    decision.shadow ? "SHADOW: esto no mueve la cola hasta que salgas de prueba." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function recommendationKeyboard(decision: EngineDecision) {
  if (decision.kind !== "recommend" || !decision.publicId) return undefined;
  return [
    [{ text: "VER PUBLICACIÓN", callback_data: `cs:${decision.publicId}:alt` }],
    [{ text: "APROBAR", callback_data: `mi:approve:${decision.recommendationId || "x"}` }],
    [{ text: "PUBLICAR AHORA", callback_data: `cs:${decision.publicId}:now` }],
    [
      { text: "OTRA HORA", callback_data: `cs:${decision.publicId}:date` },
      { text: "OTRO CONTENIDO", callback_data: `mi:skip:${decision.recommendationId || "x"}` },
    ],
    [{ text: "NO PUBLICAR HOY", callback_data: `mi:nopost:${decision.recommendationId || "x"}` }],
  ];
}
