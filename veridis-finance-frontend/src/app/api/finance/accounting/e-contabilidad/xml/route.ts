import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

// Passthrough del XML SAT. ?doc=catalogo|balanza&year=&month=&tipo=
export async function GET(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const doc = url.searchParams.get("doc") === "balanza" ? "balanza" : "catalogo";
  url.searchParams.delete("doc");
  const r = await fetch(
    backendUrl(`/api/finance/accounting/e-contabilidad/${doc}.xml?${url.searchParams.toString()}`),
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!r.ok) {
    const body = await r.text();
    let message = "No se pudo generar el XML";
    try { message = JSON.parse(body).error || message; } catch { /* texto plano */ }
    return NextResponse.json({ error: message }, { status: r.status });
  }
  const xml = await r.text();
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition":
        r.headers.get("content-disposition") || `attachment; filename="${doc}.xml"`,
    },
  });
}
