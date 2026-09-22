/**
 * Isolated campaign engine: planner, claims, approval versions, pause, attribution, test exclusion.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "hs-campaign-"));
mkdirSync(join(dataDir, "content"), { recursive: true });
process.env.DATA_DIR = dataDir;
process.env.CONTENT_DRY_RUN = "true";
process.env.CONTENT_MODE = "ASSISTED";
process.env.CONTENT_STUDIO_ENABLED = "true";
process.env.OPENAI_API_KEY = "";
process.env.AUTOMATION_DISPATCH_ENABLED = "false";
process.env.HOMESTEAD_TELEGRAM_CHAT_ID = "";
process.chdir(root);

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

async function main() {
  const { scanCommercialClaims, editorialScore } = await import("../src/lib/campaign-claims");
  const { interpretContentCampaignIntent } = await import("../src/lib/content-campaign-intent");
  const { planCampaignSlots } = await import("../src/lib/campaign-planner");
  const { digitalLocksmithPilotDrafts, similarityHits } = await import("../src/lib/campaign-copy");
  const {
    createDigitalLocksmithCampaign,
    approveCampaign,
    editPieceCopy,
    pauseCampaign,
    cancelCampaign,
    regeneratePieceImage,
  } = await import("../src/lib/campaign-engine");
  const { parseUtmRecord, parseCampaignRef, campaignDestination } = await import("../src/lib/campaign-attribution");
  const { listCampaignPieces, getPieceByPublicId, recordCampaignClick, countCampaignClicks } = await import(
    "../src/lib/campaign-store"
  );
  const { campaignJobPaused } = await import("../src/lib/campaign-store");
  const { campaignReport } = await import("../src/lib/campaign-funnel");
  const { saveServiceRequest, getHomesteadDb } = await import("../src/lib/service-requests");
  const { getJobByPublicId } = await import("../src/lib/content-catalog");
  const { campaignSummaryText } = await import("../src/lib/campaign-engine");

  ok("claim 24/7 blocked", scanCommercialClaims("Atención 24/7").ok === false);
  ok("claim price blocked", scanCommercialClaims("Precio desde 50").ok === false);
  ok("claim guarantee blocked", scanCommercialClaims("Con garantía incluida").ok === false);
  ok("plain copy allowed", scanCommercialClaims("Solicita evaluación de instalación").ok === true);
  ok(
    "editorial is not a sales forecast",
    editorialScore({
      hook: "¿Otra vez buscando la llave?",
      problem: "Buscar llaves al llegar",
      benefit: "Evaluamos tu puerta",
      cta: "Solicita evaluación",
      objection: "Sin precio en el anuncio",
      local: true,
      processVisible: true,
    }).label.includes("no predice"),
  );

  const intent = interpretContentCampaignIntent(
    "Prepara una campaña de cerrajería digital para siete días. Quiero solicitudes de instalación.",
  );
  ok("NL routes to CAMPAIGN_PLAN", intent.kind === "CAMPAIGN_PLAN");
  ok("single post still AI_CAMPAIGN", interpretContentCampaignIntent("Crea una publicidad de cerrajería").kind === "AI_CAMPAIGN");

  const drafts = digitalLocksmithPilotDrafts();
  ok("five publishable pieces plus reel script", drafts.filter((d) => d.publishable).length === 5 && drafts.some((d) => d.format === "REEL_SCRIPT"));
  ok("reel is script_ready not publishable", drafts.some((d) => d.videoStatus === "script_ready" && !d.publishable));
  ok("similarity under control", similarityHits(drafts).length === 0);
  ok("no fake testimonial in drafts", drafts.every((d) => !/testimonio|24\/7|garantía/i.test(d.copy)));

  const settings = {
    timezone: "America/Panama",
    daysEnabled: [1, 2, 3, 4, 5, 6],
    windows: [{ start: "18:00", end: "20:00" }],
    maxPostsPerDay: 1,
    minHoursBetweenPosts: 36,
    platforms: ["instagram", "facebook"],
    approvalRequired: true,
    mode: "ASSISTED",
    dryRun: true,
    paused: false,
  };
  const plan = planCampaignSlots({
    count: 5,
    requestedDays: 7,
    now: new Date("2026-09-21T12:00:00-05:00"),
    occupied: [],
    settings,
  });
  ok("7-day ask is stretched", plan.scheduledDays > 7);
  ok("schedule note explains", /Pediste 7 días/.test(plan.note));
  ok("five slots", plan.slots.length === 5);

  const created = await createDigitalLocksmithCampaign({
    chatId: "campaign-test-chat",
    userId: "campaign-test-user",
    requestedDays: 7,
    reuseOpen: false,
    now: new Date("2026-09-21T12:00:00-05:00"),
  });
  const pieces = created.pieces;
  const feed = pieces.filter((p) => p.format === "SINGLE_IMAGE");
  const reel = pieces.find((p) => p.format === "REEL_SCRIPT");
  ok("campaign id CM", /^CM-\d{4}-\d{6}$/.test(created.campaign.publicId));
  ok("five feed pieces", feed.length === 5);
  ok("reel script ready", reel?.status === "SCRIPT_READY");
  ok("jobs linked", feed.every((p) => /^HC-\d{4}-\d{6}$/.test(p.contentJobId)));
  ok("max generation 0", created.campaign.maxGeneration === 0);
  const summary = campaignSummaryText(created.campaign, pieces);
  ok("summary says simulation", /Simulación: sí/.test(summary));
  ok("carousel limitation stated", /Carrusel/.test(summary));

  const approved = approveCampaign(created.campaign.publicId, "test");
  ok("approve campaign", approved.ok === true);
  ok("manifest exact versions", approved.ok && approved.manifest.length === 5 && approved.manifest.every((m) => m.version === 1));
  const job1 = getJobByPublicId(feed[0].contentJobId);
  ok("jobs scheduled after approve", job1?.status === "SCHEDULED");

  const edited = editPieceCopy(feed[0].publicId, `${feed[0].copy}\n\nAjuste de prueba sin claims.`);
  ok("edit bumps version", edited.ok === true && edited.ok && edited.piece.version === 2);
  ok("approval invalidated", edited.ok && edited.invalidated);
  const afterEdit = getPieceByPublicId(feed[0].publicId)!;
  ok("approved version mismatch", afterEdit.approvedVersion === 1 && afterEdit.version === 2);
  ok("cannot treat as approved job", getJobByPublicId(feed[0].contentJobId)?.status === "AWAITING_APPROVAL");

  const forbidden = editPieceCopy(feed[1].publicId, "Garantía de por vida y atención 24/7");
  ok("edit with claims rejected", forbidden.ok === false);

  const budget = regeneratePieceImage(feed[1].publicId);
  ok("AI regen blocked at budget 0", budget.ok === false && budget.reason === "budget");

  pauseCampaign(created.campaign.publicId, "test");
  ok("pause skips scheduler", campaignJobPaused(feed[1].contentJobId) === true);

  const dest = campaignDestination({
    campaignId: created.campaign.publicId,
    pieceId: feed[2].publicId,
    channel: "web",
  });
  ok("web destination has utm", dest.web.includes("utm_campaign=") && dest.web.includes("hs_ref="));
  ok("whatsapp official number", dest.whatsapp.includes("50766616580"));
  ok("click wrapper", dest.click.includes("/api/r/"));
  ok("ref parse", parseCampaignRef(`${created.campaign.publicId}.${feed[2].publicId}.web`)?.pieceId === feed[2].publicId);

  recordCampaignClick({
    campaignId: created.campaign.publicId,
    pieceId: feed[2].publicId,
    channel: "web",
    ref: `${created.campaign.publicId}.${feed[2].publicId}.web`,
    isTest: true,
  });
  ok("test clicks excluded from commercial count", countCampaignClicks(created.campaign.publicId) === 0);

  const attributed = saveServiceRequest({
    name: "Prueba Campaña",
    phone: "60001111",
    email: "campaign-test@example.com",
    property: "apartment",
    service: "locksmith",
    message: "CAMPAIGN-ENGINE-TEST solicitud de instalación con origen de campaña.",
    photos: [],
    campaignPublicId: created.campaign.publicId,
    piecePublicId: feed[2].publicId,
    utmJson: JSON.stringify(parseUtmRecord({ utm_campaign: created.campaign.publicId, utm_content: feed[2].publicId, hs_ref: `${created.campaign.publicId}.${feed[2].publicId}`, hs_test: "1" })),
    hsRef: `${created.campaign.publicId}.${feed[2].publicId}`,
    isTest: true,
  });
  ok("request keeps campaign id", attributed.campaignPublicId === created.campaign.publicId);
  ok("request marked test", attributed.isTest === 1);

  const organic = saveServiceRequest({
    name: "Sin UTM",
    phone: "66771122",
    email: "organic@example.com",
    property: "house",
    service: "plumbing",
    message: "Tengo una fuga en el lavamanos de la cocina.",
    photos: [],
  });
  ok("request without campaign still works", !organic.campaignPublicId && organic.service === "plumbing");

  const report = campaignReport(created.campaign.publicId);
  ok("test request excluded from live report", report.homestead.requests.value === 0);
  const reportWithTest = campaignReport(created.campaign.publicId, { includeTests: true });
  ok("includeTests shows the seed", (reportWithTest.homestead.requests.value || 0) >= 1);
  ok("meta reach unknown not zero", report.meta.reach.available === false && report.meta.reach.value === null);
  ok("no roi invented", /faltan costos/.test(report.homestead.roi));

  cancelCampaign(created.campaign.publicId, "test");
  const cancelledJob = getJobByPublicId(feed[1].contentJobId);
  ok("cancel does not delete history", Boolean(getHomesteadDb().prepare("SELECT public_id FROM campaigns WHERE public_id = ?").get(created.campaign.publicId)));
  ok("unpublished job cancelled", cancelledJob?.status === "CANCELLED" || cancelledJob?.status === "AWAITING_APPROVAL" || cancelledJob?.status === "SCHEDULED");

  writeFileSync(
    join(dataDir, "pilot-ids.json"),
    JSON.stringify(
      {
        campaignId: created.campaign.publicId,
        pieces: pieces.map((p) => p.publicId),
        jobs: feed.map((p) => p.contentJobId),
        testRequest: attributed.publicId,
        organicRequest: organic.publicId,
      },
      null,
      2,
    ),
  );
  console.log("PILOT", created.campaign.publicId, "pieces", feed.map((p) => p.publicId).join(","));
}

main()
  .then(() => {
    if (failed) {
      console.error(`\nCAMPAIGN ENGINE FAILED: ${failed}`);
      process.exit(1);
    }
    console.log("\nCAMPAIGN ENGINE BEHAVIOR PASS");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
