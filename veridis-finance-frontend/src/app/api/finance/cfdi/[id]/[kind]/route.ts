import { NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string; kind: string } }
) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kind = params.kind === "xml" ? "xml" : "pdf";
  const backendResponse = await fetch(
    backendUrl(`/api/finance/cfdi/${params.id}/${kind}`),
    { method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store" }
  );

  if (!backendResponse.ok) {
    return NextResponse.json({ error: "Not available" }, { status: backendResponse.status });
  }

  const buffer = await backendResponse.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "content-type":
        backendResponse.headers.get("content-type") ||
        (kind === "xml" ? "application/xml" : "application/pdf"),
      "content-disposition": `attachment; filename="${params.id}.${kind}"`,
    },
  });
}
