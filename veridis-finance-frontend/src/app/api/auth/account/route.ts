import { NextRequest, NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  const backendResponse = await fetch(backendUrl("/auth/account"), {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}

export async function PUT(request: NextRequest) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  const body = await request.json();

  const backendResponse = await fetch(backendUrl("/auth/account"), {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}

export async function DELETE(request: NextRequest) {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return unauthorized();
  }

  const body = await request.json();

  const backendResponse = await fetch(backendUrl("/auth/account"), {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await parseBackendBody(backendResponse);
  return NextResponse.json(payload, { status: backendResponse.status });
}
