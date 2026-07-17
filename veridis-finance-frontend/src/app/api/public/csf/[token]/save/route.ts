import { NextResponse } from "next/server";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const body = await request.json();
  const r = await fetch(backendUrl(`/public/csf/${params.token}/save`), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
