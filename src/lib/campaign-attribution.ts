import { homesteadBrandDossier } from "@/lib/campaign-brand";
import { CAMPAIGN_ID_PATTERN, PIECE_ID_PATTERN, type Campaign, type CampaignPiece } from "@/lib/campaign-types";
import { OFFICIAL_WHATSAPP, site } from "@/lib/site";

export type CampaignRef = {
  campaignId: string;
  pieceId: string;
  channel: "web" | "ig" | "wa" | "fb";
};

export function parseCampaignRef(raw: string | null | undefined): CampaignRef | null {
  const text = String(raw || "").trim();
  const match = text.match(/^(CM-\d{4}-\d{6})[./](CP-\d{4}-\d{6})(?:[./](web|ig|wa|fb))?$/i);
  if (!match) return null;
  const channel = (match[3] || "web").toLowerCase() as CampaignRef["channel"];
  return { campaignId: match[1].toUpperCase(), pieceId: match[2].toUpperCase(), channel };
}

export function parseUtmRecord(input: Record<string, string | undefined> | null | undefined) {
  const utm = input || {};
  const fromRef = parseCampaignRef(utm.hs_ref || utm.hs || "");
  const campaignId =
    (CAMPAIGN_ID_PATTERN.test(utm.utm_campaign || "") ? utm.utm_campaign : "") || fromRef?.campaignId || "";
  const pieceId =
    (PIECE_ID_PATTERN.test(utm.utm_content || "") ? utm.utm_content : "") || fromRef?.pieceId || "";
  const isTest = utm.hs_test === "1" || /TEST/i.test(utm.utm_campaign || "") || /TEST/i.test(utm.hs_ref || "");
  return {
    campaignId,
    pieceId,
    source: utm.utm_source || "",
    medium: utm.utm_medium || "",
    isTest,
    hsRef: utm.hs_ref || (campaignId && pieceId ? `${campaignId}.${pieceId}` : ""),
  };
}

export function campaignDestination(input: {
  campaignId: string;
  pieceId: string;
  channel: CampaignRef["channel"];
  intent?: string;
}) {
  const dossier = homesteadBrandDossier();
  const origin = dossier.url.value;
  const params = new URLSearchParams({
    service: "locksmith",
    intent: input.intent || "digital_lock_purchase_install",
    utm_source: input.channel === "wa" ? "whatsapp" : input.channel === "fb" ? "facebook" : "instagram",
    utm_medium: "organic",
    utm_campaign: input.campaignId,
    utm_content: input.pieceId,
    hs_ref: `${input.campaignId}.${input.pieceId}`,
  });
  const web = `${origin}/contact?${params.toString()}`;
  const waText = [
    "Hola Homestead, quiero una evaluación para instalar una cerradura digital.",
    `Ref. ${input.campaignId}/${input.pieceId}`,
  ].join(" ");
  const whatsapp = `https://wa.me/${OFFICIAL_WHATSAPP.destination}?text=${encodeURIComponent(waText)}`;
  const click = `${origin}/api/r/${input.campaignId}.${input.pieceId}.${input.channel}`;
  return {
    web,
    whatsapp,
    click,
    instagramNote:
      "El caption de Instagram no hace clic en la URL. Conversión viable: enlace del perfil hacia homestead.lat, o WhatsApp oficial. No atribuimos la pieza si solo se vio el post.",
    site: site.url,
  };
}

export function instagramCaptionFooter(webUrl: string) {
  return [
    "Siguiente paso: enlace en el perfil (Solicitar cerrajería) o escríbenos al WhatsApp oficial.",
    webUrl,
    `WhatsApp: ${OFFICIAL_WHATSAPP.display}`,
  ].join("\n");
}
