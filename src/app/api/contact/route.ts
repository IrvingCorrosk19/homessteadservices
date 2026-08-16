import { NextResponse } from "next/server";
import { formServices, propertyTypes } from "@/lib/site";

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

    if (photos.length > 6) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    for (const file of photos) {
      if (file.size > 5 * 1024 * 1024 || !file.type.startsWith("image/")) {
        return NextResponse.json({ ok: false }, { status: 400 });
      }
    }

    console.info("[homestead-contact]", {
      name,
      phone,
      email,
      property,
      service,
      message,
      photos: photos.map((file) => ({ name: file.name, size: file.size })),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
