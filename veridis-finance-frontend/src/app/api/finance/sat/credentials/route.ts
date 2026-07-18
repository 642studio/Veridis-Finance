import { NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendResponse = await fetch(backendUrl("/api/finance/sat/credentials"), {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}

export async function POST(request: Request) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const backendResponse = await fetch(backendUrl("/api/finance/sat/credentials"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: formData,
    cache: "no-store",
  });
  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}

export async function DELETE() {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendResponse = await fetch(backendUrl("/api/finance/sat/credentials"), {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
