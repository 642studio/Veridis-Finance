import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";
export const dynamic = "force-dynamic";

export async function GET(_r: Request, { params }: { params: { id: string; evidenceId: string } }) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await fetch(
    backendUrl(`/api/finance/fiscal/cfdi/${params.id}/evidence/${params.evidenceId}`),
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!r.ok) return NextResponse.json(await parseBackendBody(r), { status: r.status });
  return new NextResponse(r.body, {
    status: r.status,
    headers: {
      "content-type": r.headers.get("content-type") || "application/octet-stream",
      "content-disposition": r.headers.get("content-disposition") || "attachment",
    },
  });
}

export async function DELETE(_r: Request, { params }: { params: { id: string; evidenceId: string } }) {
  const token = getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await fetch(
    backendUrl(`/api/finance/fiscal/cfdi/${params.id}/evidence/${params.evidenceId}`),
    { method: "DELETE", headers: { authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
