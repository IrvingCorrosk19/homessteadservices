import { NextResponse } from "next/server";
import { formServices, propertyTypes } from "@/lib/site";
import { isMailConfigured, sendContactEmail } from "@/lib/mail";
import { logError, logInfo } from "@/lib/log";
import { notifyN8n } from "@/lib/n8n";
import {
  isAllowedDeclaredType,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  sniffImage,
} from "@/lib/photos";
import { saveServiceRequest } from "@/lib/service-requests";

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
    const photos = form.getAll("photos").filter((item) => item instanceof File);

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

    const saved = saveServiceRequest({
      name,
      phone,
      email,
      property,
      service,
      message,
      photos: bufferedPhotos,
    });

    logInfo("ServiceRequestCreated", {
      requestId: saved.publicId,
      service: saved.service,
      photoCount: saved.photos.length,
    });

    void notifyN8n(saved);

    if (isMailConfigured()) {
      try {
        const photoFiles = bufferedPhotos.map(
          (photo) =>
            new File([new Uint8Array(photo.bytes)], photo.name, { type: photo.type }),
        );
        await sendContactEmail({
          requestId: saved.publicId,
          name,
          phone,
          email,
          property,
          service,
          message,
          photos: photoFiles,
        });
        logInfo("EmailNotificationSucceeded", { requestId: saved.publicId });
      } catch (error) {
        logError("EmailNotificationFailed", {
          requestId: saved.publicId,
          cause: error instanceof Error ? error.name : "unknown",
        });
      }
    } else {
      logError("EmailNotificationFailed", {
        requestId: saved.publicId,
        cause: "smtp_not_configured",
      });
    }

    return NextResponse.json({ ok: true, requestId: saved.publicId });
  } catch (error) {
    console.error("[homestead-contact]", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
