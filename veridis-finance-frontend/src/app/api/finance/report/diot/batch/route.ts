import { NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const backendResponse = await fetch(
    backendUrl(`/api/finance/report/diot/batch${url.search}`),
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );

  if (!backendResponse.ok) {
    return NextResponse.json({ error: "No disponible" }, { status: backendResponse.status });
  }

  const text = await backendResponse.text();
  return new NextResponse(text, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition":
        backendResponse.headers.get("content-disposition") || "attachment; filename=DIOT.txt",
    },
  });
}
