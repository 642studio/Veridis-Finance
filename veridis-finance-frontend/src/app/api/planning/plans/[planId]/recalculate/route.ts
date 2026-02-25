import { NextRequest, NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(
  _request: NextRequest,
  context: { params: { planId: string } }
) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  const backendResponse = await fetch(
    backendUrl(`/api/planning/plans/${context.params.planId}/recalculate`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
