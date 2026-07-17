import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";
export const dynamic = "force-dynamic";
export async function GET() {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await fetch(backendUrl("/integrations/crm/pending"), {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store",
  });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
