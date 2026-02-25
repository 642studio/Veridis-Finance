import { NextRequest, NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(
  request: NextRequest,
  context: { params: { importId: string } }
) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };

  const init: RequestInit = {
    method: "POST",
    headers,
    cache: "no-store",
  };

  if (body !== null) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const backendResponse = await fetch(
    backendUrl(`/api/finance/bank-statements/confirm/${context.params.importId}`),
    init
  );

  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
