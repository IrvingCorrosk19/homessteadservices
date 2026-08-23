import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const intent = readFileSync(join(root, "src/lib/content-campaign-intent.ts"), "utf8");
const openai = readFileSync(join(root, "src/lib/content-openai.ts"), "utf8");
const processMod = readFileSync(join(root, "src/lib/content-process.ts"), "utf8");
const handler = readFileSync(join(root, "src/lib/content-handler.ts"), "utf8");
const publish = readFileSync(join(root, "src/lib/content-publish.ts"), "utf8");
const images = readFileSync(join(root, "src/lib/content-images.ts"), "utf8");
const types = readFileSync(join(root, "src/lib/content-types.ts"), "utf8");
const n8n = readFileSync(join(root, "n8n/homestead-n8n-content-studio.json"), "utf8");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("CSV3-01 intent AI_CAMPAIGN", /AI_CAMPAIGN/.test(intent) && /interpretContentCampaignIntent/.test(intent));
ok("CSV3-02 intent IDEATION", /IDEATION/.test(intent));
ok("CSV3-03 brand profile", /homesteadBrandProfile/.test(intent));
ok("CSV3-04 no fake prices in brand forbidden", /precios inventados/.test(intent));
ok("CSV3-05 openai image generations", /images\/generations/.test(openai));
ok("CSV3-06 writeAiCampaignCopy", /writeAiCampaignCopy/.test(openai));
ok("CSV3-07 generateCampaignImage", /generateCampaignImage/.test(openai));
ok("CSV3-08 ai campaign copy forbids real-job claim", /no es un trabajo ya realizado|NO digas que es un trabajo/.test(openai));
ok("CSV3-09 processAiCampaignJob", /processAiCampaignJob/.test(processMod));
ok("CSV3-10 startAiCampaignFromChat", /startAiCampaignFromChat/.test(processMod));
ok("CSV3-11 versioned approve callback", /approve:v\$\{version\}/.test(processMod));
ok("CSV3-12 AI origin label in preview", /Creatividad AI/.test(processMod));
ok("CSV3-13 revision clears approval", /approvedAt:\s*null/.test(processMod));
ok("CSV3-14 handler NL before copilot", /interpretContentCampaignIntent/.test(handler));
ok("CSV3-15 stale version gate", /stale_version|ya fue reemplazada/.test(handler));
ok("CSV3-16 aigen retry", /aigen/.test(handler));
ok("CSV3-17 research not fabricated", /Research web externo: NO CONFIGURADO/.test(handler));
ok("CSV3-18 existing n8n reused", /homestead-content-studio/.test(n8n));
ok("CSV3-19 no autonomous publish default", /dryRun|metaConfigured/.test(publish));
ok("CSV3-20 watermark deterministic", /applyHomesteadWatermark/.test(images));
ok("CSV3-21 content statuses include APPROVED", /APPROVED/.test(types));
ok("CSV3-22 silence not approval", /tryApproveContentJob/.test(handler) && !/auto.?approv/i.test(handler));
ok("CSV3-23 one generation default", /Generando 1 visual/.test(processMod));
ok("CSV3-24 cost control note", /sin generar imágenes todavía|1 propuesta/.test(handler));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nCONTENT STUDIO V3 static checks OK");
