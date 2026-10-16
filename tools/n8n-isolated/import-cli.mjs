/**
 * Import + activate workflow via n8n CLI against isolated user folder (no API key).
 * Uses portable Node 22 when present.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const userFolder = join(root, "data", "n8n-isolated");
const wfPath = join(root, "n8n", "homestead-n8n-concierge-turn.json");
mkdirSync(userFolder, { recursive: true });

const portableNode = join(userFolder, "node-v22", "node-v22.14.0-win-x64", "node.exe");
const nodeBin = existsSync(portableNode) ? portableNode : process.execPath;
const entry = join(__dirname, "node_modules", "n8n", "bin", "n8n");

function loadSecret() {
  if (process.env.CONCIERGE_INTERNAL_SECRET) return process.env.CONCIERGE_INTERNAL_SECRET;
  const secretFile = join(userFolder, ".secret");
  if (existsSync(secretFile)) return readFileSync(secretFile, "utf8").trim();
  return "";
}

const secret = loadSecret();
const encKeyFile = join(userFolder, ".encryption-key");
const encryptionKey =
  process.env.N8N_ENCRYPTION_KEY ||
  (existsSync(encKeyFile) ? readFileSync(encKeyFile, "utf8").trim() : secret.padEnd(32, "0").slice(0, 32));

const env = {
  ...process.env,
  N8N_USER_FOLDER: userFolder,
  N8N_ENCRYPTION_KEY: encryptionKey,
  CONCIERGE_INTERNAL_SECRET: secret,
  HOMESTEAD_INTERNAL_BASE: process.env.HOMESTEAD_INTERNAL_BASE || "http://127.0.0.1:3095",
};

function run(args) {
  console.log(">", nodeBin, entry, ...args);
  const r = spawnSync(nodeBin, [entry, ...args], {
    env,
    cwd: __dirname,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error("CLI failed", r.status);
    process.exit(r.status || 1);
  }
  return r.stdout || "";
}

if (!existsSync(wfPath)) {
  console.error("Missing workflow", wfPath);
  process.exit(1);
}

// n8n CLI expects an array and a non-null `active` field
const importPath = join(userFolder, "import-wf.json");
const raw = JSON.parse(readFileSync(wfPath, "utf8"));
raw.active = false;
writeFileSync(importPath, JSON.stringify([raw]));

run(["import:workflow", `--input=${importPath}`]);
const listOut = run(["list:workflow"]);
// list format: id|name
const lines = listOut.split(/\r?\n/).filter(Boolean);
const hit =
  lines.find((l) => /concierge/i.test(l)) ||
  lines.find((l) => /homestead/i.test(l)) ||
  lines[lines.length - 1];
if (!hit) {
  console.error("No workflow id found after import");
  process.exit(1);
}
const id = hit.split("|")[0].trim();
console.log("WORKFLOW_ID", id);
run(["update:workflow", `--id=${id}`, "--active=true"]);
console.log("ACTIVATED", id);
console.log("WEBHOOK http://127.0.0.1:5679/webhook/homestead-concierge-turn");
