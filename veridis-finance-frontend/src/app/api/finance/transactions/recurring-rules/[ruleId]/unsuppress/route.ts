import { NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: {
    ruleId: string;
  };
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(_: Request, { params }: RouteParams) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  const backendResponse = await fetch(
    backendUrl(`/api/finance/transactions/recurring-rules/${params.ruleId}/unsuppress`),
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
