import { NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.text();
  const backendResponse = await fetch(backendUrl("/api/finance/reconciliation/auto"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body || "{}",
    cache: "no-store",
  });
  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
