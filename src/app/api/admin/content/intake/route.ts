import { NextResponse } from "next/server";
import { requireAdminMutation } from "@/lib/control-auth";
import { ingestControlPhotos } from "@/lib/control-intake";
import { MAX_CONTENT_PHOTOS } from "@/lib/content-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const form = await request.formData();
  const note = String(form.get("note") || "");
  const files = form.getAll("files").filter((item) => item instanceof File);
  if (!files.length) {
    return NextResponse.json({ ok: false, error: "no_files" }, { status: 400 });
  }
  if (files.length > MAX_CONTENT_PHOTOS) {
    return NextResponse.json({ ok: false, error: "too_many" }, { status: 400 });
  }
  const buffers = await Promise.all(
    files.map(async (file) => ({
      filename: file.name || "foto.jpg",
      bytes: Buffer.from(await file.arrayBuffer()),
      declaredType: file.type,
    })),
  );
  const result = await ingestControlPhotos({
    files: buffers,
    note,
    actor: "admin-web",
  });
  return NextResponse.json(result, { status: result.ok ? 202 : 400 });
}
