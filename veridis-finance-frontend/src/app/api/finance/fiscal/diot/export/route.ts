import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl } from "@/lib/backend-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const r = await fetch(backendUrl(`/api/finance/fiscal/diot/export${url.search}`), {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: "No se pudo generar la DIOT" }, { status: r.status });
  const body = await r.text();
  return new NextResponse(body, { status: 200, headers: {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": r.headers.get("content-disposition") || 'attachment; filename="DIOT.txt"',
  }});
}
