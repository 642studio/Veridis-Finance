import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "balanza",
  "mayor",
  "diario",
  "estado-resultados",
  "balance-general",
]);

export async function GET(
  request: Request,
  { params }: { params: { report: string } }
) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.has(params.report)) {
    return NextResponse.json({ error: "Reporte no válido" }, { status: 404 });
  }
  const url = new URL(request.url);
  const r = await fetch(
    backendUrl(`/api/finance/accounting/reports/${params.report}${url.search}`),
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
