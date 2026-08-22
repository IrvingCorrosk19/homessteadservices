import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import {
  listAgenda,
  listPendingRequests,
  listRescueLeads,
  panamaToday,
  upcomingAgenda,
} from "@/lib/ops-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = { source: "ops-lists" };
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const includeTest = url.searchParams.get("test") === "1";
  const kind = url.searchParams.get("kind") || "requests";
  if (kind === "requests") {
    return NextResponse.json({ ok: true, rows: listPendingRequests(includeTest) });
  }
  if (kind === "rescue") {
    return NextResponse.json({
      ok: true,
      rows: listRescueLeads(includeTest).map((lead) =>
        lead
          ? {
              leadId: lead.leadId,
              service: lead.service,
              location: lead.location,
              createdAt: lead.leadCreatedAt,
            }
          : null,
      ),
    });
  }
  if (kind === "appointments") {
    const ymd = url.searchParams.get("date") || panamaToday().ymd;
    return NextResponse.json({
      ok: true,
      ymd,
      rows: listAgenda(ymd, includeTest).map((item) => ({
        appointmentId: item.appointmentId,
        date: item.date,
        startTime: item.startTime,
        service: item.service,
        zone: item.zone,
      })),
    });
  }
  if (kind === "upcoming") {
    return NextResponse.json({
      ok: true,
      rows: upcomingAgenda(includeTest).map((item) => ({
        appointmentId: item.appointmentId,
        date: item.date,
        startTime: item.startTime,
      })),
    });
  }
  return NextResponse.json({ ok: false, error: "unknown_kind" }, { status: 400 });
}
