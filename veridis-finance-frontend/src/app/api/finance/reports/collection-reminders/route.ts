import { NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendResponse = await fetch(
    backendUrl("/api/finance/report/collection-reminders"),
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );
  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
