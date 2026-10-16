/**
 * Import + activate homestead-n8n-concierge-turn.json into isolated n8n via REST.
 * Requires n8n already running with N8N_BASIC_AUTH or owner setup completed.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const wfPath = join(root, "n8n", "homestead-n8n-concierge-turn.json");
const base = (process.env.N8N_BASE_URL || "http://127.0.0.1:5679").replace(/\/$/, "");
const apiKey = process.env.N8N_API_KEY || "";
const user = process.env.N8N_BASIC_AUTH_USER || "";
const pass = process.env.N8N_BASIC_AUTH_PASSWORD || "";

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
const headers = { "content-type": "application/json" };
if (apiKey) headers["X-N8N-API-KEY"] = apiKey;
else if (user && pass) {
  headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function main() {
  // Prefer public API if key present
  if (apiKey) {
    const create = await fetch(`${base}/api/v1/workflows`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings || {},
      }),
    });
    const created = await create.json();
    if (!create.ok) {
      console.error("CREATE_FAIL", create.status, JSON.stringify(created).slice(0, 400));
      process.exit(1);
    }
    const id = created.id;
    const activate = await fetch(`${base}/api/v1/workflows/${id}/activate`, {
      method: "POST",
      headers,
    });
    console.log("IMPORTED", id, "ACTIVATE", activate.status);
    console.log("WEBHOOK", `${base}/webhook/homestead-concierge-turn`);
    return;
  }

  // CLI fallback via npx when no API key
  console.error("N8N_API_KEY missing — use CLI import:");
  console.error(
    `  cd tools/n8n-isolated && npx n8n import:workflow --input="${wfPath}" && npx n8n update:workflow --id=<ID> --active=true`,
  );
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
