import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.text();
  const r = await fetch(backendUrl("/api/finance/accounting/bank-polizas"), {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body, cache: "no-store" });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
