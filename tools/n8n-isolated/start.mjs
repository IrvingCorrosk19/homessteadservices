/**
 * Start isolated n8n (port 5679) with its own user folder + portable Node 22.
 * Secrets from env / data/n8n-isolated/.secret — never committed.
 */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const userFolder = join(root, "data", "n8n-isolated");
mkdirSync(userFolder, { recursive: true });
writeFileSync(
  join(userFolder, "ISOLATED.txt"),
  "Homestead isolated n8n. Do not point production webhooks here.\n",
  "utf8",
);

function loadSecret() {
  if (process.env.CONCIERGE_INTERNAL_SECRET) return process.env.CONCIERGE_INTERNAL_SECRET;
  const secretFile = join(userFolder, ".secret");
  if (existsSync(secretFile)) return readFileSync(secretFile, "utf8").trim();
  return "";
}

const secret = loadSecret();
if (!secret) {
  console.error("CONCIERGE_INTERNAL_SECRET missing (env or data/n8n-isolated/.secret)");
  process.exit(2);
}

const portableNode = join(
  userFolder,
  "node-v22",
  "node-v22.14.0-win-x64",
  "node.exe",
);
const nodeBin = existsSync(portableNode) ? portableNode : process.execPath;
if (!existsSync(portableNode)) {
  console.warn("WARN: portable Node 22 not found; using", process.execPath, "(n8n requires <=22)");
}

const encKeyFile = join(userFolder, ".encryption-key");
let encryptionKey = process.env.N8N_ENCRYPTION_KEY || "";
if (!encryptionKey && existsSync(encKeyFile)) {
  encryptionKey = readFileSync(encKeyFile, "utf8").trim();
}
if (!encryptionKey) {
  encryptionKey = secret.padEnd(32, "0").slice(0, 32);
  writeFileSync(encKeyFile, encryptionKey, "utf8");
}

const env = {
  ...process.env,
  N8N_USER_FOLDER: userFolder,
  N8N_ENCRYPTION_KEY: encryptionKey,
  N8N_PORT: process.env.N8N_PORT || "5679",
  N8N_HOST: "127.0.0.1",
  N8N_LISTEN_ADDRESS: "127.0.0.1",
  N8N_PROTOCOL: "http",
  WEBHOOK_URL: process.env.WEBHOOK_URL || "http://127.0.0.1:5679/",
  N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_PERSONALIZATION_ENABLED: "false",
  N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
  N8N_HIRING_BANNER_ENABLED: "false",
  EXECUTIONS_DATA_SAVE_ON_SUCCESS: "all",
  EXECUTIONS_DATA_SAVE_ON_ERROR: "all",
  N8N_SECURE_COOKIE: "false",
  N8N_PATH: "/",
  HOMESTEAD_INTERNAL_BASE: process.env.HOMESTEAD_INTERNAL_BASE || "http://127.0.0.1:3095",
  CONCIERGE_INTERNAL_SECRET: secret,
};

const bin = join(__dirname, "node_modules", "n8n", "bin", "n8n");
const entry = existsSync(bin) ? bin : join(__dirname, "node_modules", "n8n", "bin", "n8n.js");
console.log(`Starting isolated n8n on ${env.N8N_HOST}:${env.N8N_PORT}`);
console.log(`User folder: ${userFolder}`);
console.log(`Node: ${nodeBin}`);
const child = spawn(nodeBin, [entry, "start"], { env, stdio: "inherit", cwd: __dirname });
child.on("exit", (code) => process.exit(code ?? 1));
