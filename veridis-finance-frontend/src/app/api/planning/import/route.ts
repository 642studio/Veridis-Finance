import { NextRequest, NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  const formData = await request.formData();

  const backendResponse = await fetch(backendUrl("/api/planning/import"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: formData,
    cache: "no-store",
  });

  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
