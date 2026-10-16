/**
 * Start Next.js against control-test DATA_DIR for remote n8n tests.
 * Secrets must already be in env (CONCIERGE_INTERNAL_SECRET, etc.).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = process.cwd();
const dataDir = applyControlIsolatedEnv(root, "test");
assertSafeToMutateControlDev(dataDir, "start-isolated");
mkdirSync(dataDir, { recursive: true });

if (!process.env.CONCIERGE_INTERNAL_SECRET) {
  console.error("Set CONCIERGE_INTERNAL_SECRET outside the repo before starting");
  process.exit(2);
}

const port = process.env.PORT || "3095";
const env = {
  ...process.env,
  DATA_DIR: dataDir,
  HOMESTEAD_CONTROL_ISOLATED: "true",
  AI_CONCIERGE_ENABLED: "true",
  AI_CONCIERGE_ENGINE: "n8n",
  AI_CONCIERGE_N8N_MODE: "remote",
  AI_CONCIERGE_DRY_RUN: "true",
  AI_CONCIERGE_CREATE_LEADS: "true",
  AI_CONCIERGE_TURN_TIMEOUT_MS: "60000",
  N8N_CONCIERGE_TURN_WEBHOOK_URL:
    process.env.N8N_CONCIERGE_TURN_WEBHOOK_URL || "http://127.0.0.1:5679/webhook/homestead-concierge-turn",
  NEXT_PUBLIC_PHONE: process.env.NEXT_PUBLIC_PHONE || "+507 6000-1111",
  NEXT_PUBLIC_OFFICIAL_WHATSAPP: process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP || "true",
  AUTOMATION_DISPATCH_ENABLED: "false",
  PORT: port,
};

writeFileSync(
  join(dataDir, "RUNTIME.txt"),
  `started=${new Date().toISOString()}\nengine=n8n\nmode=remote\nport=${port}\n`,
  "utf8",
);

// Strip portable n8n Node 22 from PATH so better-sqlite3 matches system Node.
const pathKey = process.platform === "win32" ? "Path" : "PATH";
const cleanPath = String(env[pathKey] || env.PATH || "")
  .split(process.platform === "win32" ? ";" : ":")
  .filter((p) => p && !/node-v22|n8n-isolated[\\/]+node/i.test(p))
  .join(process.platform === "win32" ? ";" : ":");
env.PATH = cleanPath;
env.Path = cleanPath;

console.log(`Isolated Next on http://127.0.0.1:${port} DATA_DIR=${dataDir}`);
console.log(`Node for Next: ${process.version} (${process.execPath})`);
const child = spawn("npx", ["next", "dev", "-p", port, "-H", "127.0.0.1"], {
  env,
  stdio: "inherit",
  cwd: root,
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
