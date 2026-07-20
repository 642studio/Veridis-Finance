import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const r = await fetch(backendUrl(`/api/finance/accounting/accounts${url.search}`), {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
export async function POST(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const r = await fetch(backendUrl("/api/finance/accounting/accounts"), {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store" });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
