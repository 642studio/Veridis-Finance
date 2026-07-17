import { NextResponse } from "next/server";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const formData = await request.formData();
  const r = await fetch(backendUrl(`/public/csf/${params.token}/preview`), {
    method: "POST", body: formData, cache: "no-store",
  });
  return NextResponse.json(await parseBackendBody(r), { status: r.status });
}
