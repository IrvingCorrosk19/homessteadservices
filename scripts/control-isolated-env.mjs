import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MARKER = "CONTROL_DEV.txt";

export function controlDevDir(root) {
  return resolve(join(root, "data", "control-dev"));
}

export function controlTestDir(root) {
  return resolve(join(root, "data", "control-test"));
}

function markerText(kind) {
  return `Base aislada de Homestead Control (${kind}). El scheduler de producción no debe apuntar aquí.\n`;
}

export function isIsolatedControlDir(dataDir) {
  const normalized = resolve(dataDir).replaceAll("\\", "/");
  const allowed = normalized.endsWith("/data/control-dev") || normalized.endsWith("/data/control-test");
  return allowed && existsSync(join(dataDir, MARKER));
}

export function isControlDevDir(dataDir) {
  return isIsolatedControlDir(dataDir);
}

export function assertControlDevDir(dataDir) {
  if (!isIsolatedControlDir(dataDir)) {
    throw new Error(`control_isolated_dir_required:${dataDir}`);
  }
}

export function assertSafeToMutateControlDev(dataDir, action) {
  assertControlDevDir(dataDir);
  const normalized = resolve(dataDir).replaceAll("\\", "/");
  const allowed =
    normalized.endsWith("/data/control-dev") || normalized.endsWith("/data/control-test");
  if (!allowed) {
    throw new Error(`refusing_${action}_outside_isolated_dir:${dataDir}`);
  }
  if (normalized.includes("/data/control-dev/") && !normalized.endsWith("/data/control-dev")) {
    throw new Error(`refusing_${action}_nested_path:${dataDir}`);
  }
  if (normalized.includes("/data/control-test/") && !normalized.endsWith("/data/control-test")) {
    throw new Error(`refusing_${action}_nested_path:${dataDir}`);
  }
}

export function applyControlIsolatedEnv(root, kind = "dev") {
  const dataDir = kind === "test" ? controlTestDir(root) : controlDevDir(root);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, MARKER), markerText(kind), "utf8");
  process.env.HOMESTEAD_CONTROL_ISOLATED = "true";
  process.env.DATA_DIR = dataDir;
  process.env.CONTENT_DRY_RUN = "false";
  process.env.CONTENT_MODE = "ASSISTED";
  process.env.CONTENT_PUBLISH_ENABLED = "true";
  process.env.CONTENT_STUDIO_ENABLED = "true";
  process.env.ADMIN_PASSWORD = "control-local";
  process.env.ADMIN_SESSION_SECRET = "control-local-session-secret";
  process.env.CONTENT_MEDIA_SIGNING_SECRET = "control-sign";
  process.env.N8N_HOMESTEAD_WEBHOOK_URL = "";
  process.env.N8N_HOMESTEAD_WEBHOOK_SECRET = "";
  process.env.TELEGRAM_BOT_TOKEN = "";
  process.env.OPENAI_API_KEY = "";
  process.env.SMTP_HOST = "";
  process.env.SMTP_PASS = "";
  process.env.SMTP_USER = "";
  process.env.META_PAGE_ACCESS_TOKEN = "";
  process.env.FACEBOOK_PAGE_ID = "sim-facebook-page";
  process.env.INSTAGRAM_ACCOUNT_ID = "sim-instagram-account";
  process.env.AUTOMATION_DISPATCH_ENABLED = "false";
  delete process.env.NEXT_PUBLIC_HOMESTEAD_CONTROL_ISOLATED;
  assertControlDevDir(dataDir);
  return dataDir;
}
