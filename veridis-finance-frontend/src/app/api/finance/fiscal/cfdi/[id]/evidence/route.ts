import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";
export const dynamic = "force-dynamic";

export async function GET(_r: Request, { params }: { params: { id: string } }) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await fetch(backendUrl(`/api/finance/fiscal/cfdi/${params.id}/evidence`), {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store",
  });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const formData = await request.formData();
  const r = await fetch(backendUrl(`/api/finance/fiscal/cfdi/${params.id}/evidence`), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: formData,
    cache: "no-store",
  });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
