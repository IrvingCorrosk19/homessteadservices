import { NextResponse } from "next/server";
import { adminGlobalSearch } from "@/lib/admin-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const results = adminGlobalSearch(q, 6);
  return NextResponse.json({ results });
}
