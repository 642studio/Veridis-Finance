import { NextRequest, NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

const ALLOWED_SECTIONS = new Set([
  "overview",
  "results",
]);

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(
  _request: NextRequest,
  context: { params: { planId: string; section: string } }
) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  const section = String(context.params.section || "").trim().toLowerCase();
  if (!ALLOWED_SECTIONS.has(section)) {
    return NextResponse.json({ error: "Unsupported planning section" }, { status: 404 });
  }

  const backendResponse = await fetch(
    backendUrl(`/api/planning/plans/${context.params.planId}/${section}`),
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
