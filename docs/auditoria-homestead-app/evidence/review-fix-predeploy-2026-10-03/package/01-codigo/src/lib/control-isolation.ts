import { logInfo } from "@/lib/log";

export type SimulatedProvider = "meta" | "telegram" | "smtp" | "openai" | "n8n";
export type SimulatedGraphScenario =
  | "ok"
  | "fail_facebook"
  | "fail_instagram"
  | "fail_all"
  | "uncertain_facebook"
  | "fail_ig_second_child"
  | "fail_ig_child_wait"
  | "fail_ig_carousel_parent";
export type SimulatedNotifyScenario = "ok" | "fail_once" | "fail";

export type SimulatedCallRecord = {
  provider: SimulatedProvider;
  at: string;
  detail: string;
  /** Sanitized Graph request snapshot (no tokens). */
  request?: {
    method: string;
    path: string;
    bodyKeys?: string[];
    imageUrlCount?: number;
    childrenCount?: number;
    mediaType?: string;
    isCarouselItem?: boolean;
    attachedMediaCount?: number;
  };
};

const calls: SimulatedCallRecord[] = [];
let graphScenario: SimulatedGraphScenario = "ok";
let notifyScenario: SimulatedNotifyScenario = "ok";
let notifyFailBudget = 0;
/** Counts IG carousel children created in the current scenario (process-local). */
let igCarouselChildCreates = 0;

export function isControlIsolated() {
  return process.env.HOMESTEAD_CONTROL_ISOLATED === "true";
}

export function assertIsolatedDataDir() {
  if (!isControlIsolated()) return;
  const dir = (process.env.DATA_DIR || "").replaceAll("\\", "/");
  if (!dir.endsWith("/data/control-dev") && !dir.endsWith("/data/control-test")) {
    throw new Error("isolated_data_dir_required");
  }
}

const BLOCKED_OUTBOUND = /graph\.facebook|api\.telegram|api\.openai|n8n\.|autonomousflow|smtp\./i;

export function assertIsolatedOutboundBlocked(url: string) {
  if (!isControlIsolated()) return;
  if (BLOCKED_OUTBOUND.test(url)) {
    throw new Error(`isolated_outbound_blocked:${url.slice(0, 80)}`);
  }
}

export function assertIsolatedSecretsCleared() {
  if (!isControlIsolated()) return;
  const leaks = [
    ["META_PAGE_ACCESS_TOKEN", process.env.META_PAGE_ACCESS_TOKEN],
    ["TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["SMTP_PASS", process.env.SMTP_PASS],
    ["SMTP_HOST", process.env.SMTP_HOST],
    ["N8N_HOMESTEAD_WEBHOOK_URL", process.env.N8N_HOMESTEAD_WEBHOOK_URL],
    ["N8N_HOMESTEAD_WEBHOOK_SECRET", process.env.N8N_HOMESTEAD_WEBHOOK_SECRET],
  ].filter(([, value]) => Boolean(value?.trim()));
  if (leaks.length) {
    throw new Error(`isolated_secrets_present:${leaks.map(([name]) => name).join(",")}`);
  }
  if (process.env.ADMIN_PASSWORD !== "control-local") {
    throw new Error("isolated_password_must_be_control_local");
  }
  if (process.env.NEXT_PUBLIC_HOMESTEAD_CONTROL_ISOLATED) {
    throw new Error("isolated_flag_must_not_be_public");
  }
}

export function recordSimulatedCall(
  provider: SimulatedProvider,
  detail = "",
  request?: SimulatedCallRecord["request"],
) {
  const at = new Date().toISOString();
  calls.push({
    provider,
    at,
    detail: detail.slice(0, 180),
    ...(request ? { request } : {}),
  });
  logInfo("ControlProviderSimulated", { stage: provider, contentJobId: detail.slice(0, 24) });
}

export function listSimulatedCalls() {
  return [...calls];
}

export function resetSimulatedCalls() {
  calls.length = 0;
}

export function setSimulatedGraphScenario(scenario: SimulatedGraphScenario) {
  graphScenario = scenario;
  igCarouselChildCreates = 0;
}

export function noteIgCarouselChildCreated() {
  igCarouselChildCreates += 1;
  return igCarouselChildCreates;
}

export function getIgCarouselChildCreateCount() {
  return igCarouselChildCreates;
}

export function getSimulatedGraphScenario() {
  return graphScenario;
}

export function setSimulatedNotifyScenario(scenario: SimulatedNotifyScenario) {
  notifyScenario = scenario;
  notifyFailBudget = scenario === "fail_once" ? 1 : scenario === "fail" ? Number.POSITIVE_INFINITY : 0;
}

export function getSimulatedNotifyScenario() {
  return notifyScenario;
}

/** Throws when isolated notify drain should simulate SMTP failure. */
export function maybeThrowSimulatedNotifyFailure() {
  if (!isControlIsolated()) return;
  if (notifyFailBudget <= 0) return;
  notifyFailBudget -= 1;
  if (notifyFailBudget <= 0 && notifyScenario === "fail_once") {
    notifyScenario = "ok";
  }
  throw new Error("simulated_smtp_denied");
}

export function isolatedCopyFallback(publicId: string) {
  return {
    serviceGuess: "servicio del hogar",
    ratings: [{ index: 1, label: "PRIMARY" as const, notes: "Imagen recibida. Texto local, sin modelo externo." }],
    privacy: { people: false, plates: false, documents: false, warning: "" },
    copy: {
      full: `Trabajo documentado por Homestead. Folio ${publicId}. Texto generado en modo aislado: no describe un resultado que no esté en la foto.`,
      commercial: `Homestead Services. Folio ${publicId}. Revisa la foto y confirma el texto antes de publicar.`,
      warm: `Así llegó este trabajo a Homestead. Folio ${publicId}.`,
      educational: `Mantenimiento y reparaciones en Panamá. Folio ${publicId}.`,
      cta: "Agenda en homestead.lat",
      hashtags: ["#HomesteadServices", "#Panama"],
    },
  };
}
