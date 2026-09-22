import { NextResponse } from "next/server";
import { formServices, propertyTypes } from "@/lib/site";
import { logInfo } from "@/lib/log";
import {
  isAllowedDeclaredType,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  sniffImage,
} from "@/lib/photos";
import { dispatchServiceRequest, persistServiceRequest } from "@/lib/service-request-service";
import { parseUtmRecord } from "@/lib/campaign-attribution";
import { recordCampaignEvent } from "@/lib/campaign-store";
import { getServiceRequirements, isDigitalLockEvidenceIntent } from "@/lib/service-requirements";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedServices = new Set<string>(formServices);
const allowedProperties = new Set<string>(propertyTypes);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const honeypot = String(form.get("website") ?? "");
    if (honeypot) {
      return NextResponse.json({ ok: true });
    }

    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const property = String(form.get("property") ?? "").trim();
    const service = String(form.get("service") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();
    const intent = String(form.get("intent") ?? form.get("subtype") ?? "").trim();
    const photos = form.getAll("photos").filter((item) => item instanceof File);
    const slotHints = form.getAll("photoSlots").map((item) => String(item || ""));

    if (
      !name ||
      !phone ||
      !emailPattern.test(email) ||
      !allowedProperties.has(property) ||
      !allowedServices.has(service) ||
      message.length < 8
    ) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    if (service === "locksmith" && !intent) {
      return NextResponse.json(
        {
          ok: false,
          code: "LOCKSMITH_INTENT_REQUIRED",
          message: "Indica qué necesitas en cerrajería para continuar.",
        },
        { status: 422 },
      );
    }

    if (photos.length > MAX_PHOTOS) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const bufferedPhotos = [];
    for (const file of photos) {
      if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
        return NextResponse.json({ ok: false }, { status: 400 });
      }
      if (file.type && !isAllowedDeclaredType(file.type)) {
        return NextResponse.json({ ok: false }, { status: 400 });
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const sniffed = sniffImage(bytes);
      if (!sniffed) {
        return NextResponse.json({ ok: false }, { status: 400 });
      }
      bufferedPhotos.push({
        name: file.name || sniffed.ext,
        size: file.size,
        type: sniffed.mime,
        bytes,
        sniffed,
      });
    }

    const requirements = getServiceRequirements({ service, intent, message });
    let factsPayload: Record<string, unknown> = {
      entrySource: "website",
      entryPoint: "contact_form",
      serviceIntent: requirements.intentId,
    };

    if (isDigitalLockEvidenceIntent(requirements.intentId)) {
      const evidence = await validateDigitalLockFormEvidence({
        service,
        intent,
        message,
        photos: bufferedPhotos.map((photo, index) => ({
          name: photo.name,
          bytes: photo.bytes,
          type: photo.type,
          slotHint: (slotHints[index] as "front" | "inside" | "edge" | "") || "",
        })),
      });

      if (!evidence.ok) {
        return NextResponse.json(
          {
            ok: false,
            code: evidence.code || "DIGITAL_LOCK_PHOTO_REQUIREMENTS_INCOMPLETE",
            message: evidence.message,
            missing: evidence.missing,
            evidence: checklistPublicSummary(evidence.checklist),
          },
          { status: 422 },
        );
      }

      factsPayload = {
        ...factsPayload,
        digitalLockFlow: "1",
        digitalLockChecklist: JSON.stringify(evidence.checklist),
        need: "cerradura digital — compra/instalación",
      };
    }

    const utm = parseUtmRecord({
      utm_source: String(form.get("utm_source") ?? ""),
      utm_medium: String(form.get("utm_medium") ?? ""),
      utm_campaign: String(form.get("utm_campaign") ?? ""),
      utm_content: String(form.get("utm_content") ?? ""),
      hs_ref: String(form.get("hs_ref") ?? form.get("ref") ?? ""),
      hs_test: String(form.get("hs_test") ?? ""),
    });
    const isTest =
      utm.isTest || /CAMPAIGN-ENGINE-TEST|HS-TEST-CAMPAIGN/i.test(message);

    factsPayload = {
      ...factsPayload,
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaignId,
      utm_content: utm.pieceId,
      hs_ref: utm.hsRef,
    };

    const saved = await persistServiceRequest({
      name,
      phone,
      email,
      property,
      service,
      message,
      photos: bufferedPhotos,
      factsJson: JSON.stringify(factsPayload),
      campaignPublicId: utm.campaignId,
      piecePublicId: utm.pieceId,
      utmJson: JSON.stringify({
        utm_source: utm.source,
        utm_medium: utm.medium,
        utm_campaign: utm.campaignId,
        utm_content: utm.pieceId,
        hs_ref: utm.hsRef,
      }),
      hsRef: utm.hsRef,
      isTest,
    });

    const hsRef = String(form.get("hs_ref") ?? form.get("ref") ?? "").trim();
    if (/^HC-\d{4}-\d{6}$/.test(hsRef)) {
      const { recordLead } = await import("@/lib/marketing-store");
      recordLead({ publicId: hsRef, channel: "website", outcome: "CONTACT" });
    }

    if (utm.campaignId) {
      recordCampaignEvent(utm.campaignId, "REQUEST", saved.publicId, utm.pieceId);
    }

    logInfo("ServiceRequestCreated", {
      requestId: saved.publicId,
      service: saved.service,
      photoCount: saved.photos.length,
      intent: requirements.intentId,
    });

    if (!isTest) {
      const photoFiles = bufferedPhotos.map(
        (photo) => new File([new Uint8Array(photo.bytes)], photo.name, { type: photo.type }),
      );
      await dispatchServiceRequest(saved, { email: true, n8n: true, photos: photoFiles });
    }

    return NextResponse.json({ ok: true, requestId: saved.publicId, test: isTest });
  } catch (error) {
    console.error("[homestead-contact]", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
