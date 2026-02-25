import { NextResponse } from "next/server";

import { authCookieOptions, AUTH_COOKIE_NAME } from "@/lib/auth";
import { backendUrl, parseBackendBody } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const backendResponse = await fetch(backendUrl("/auth/login"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await parseBackendBody(backendResponse);

    if (!backendResponse.ok) {
      return NextResponse.json(payload, { status: backendResponse.status });
    }

    const token = payload?.data?.token;

    if (!token) {
      return NextResponse.json(
        { error: "Backend login response missing token" },
        { status: 502 }
      );
    }

    const response = NextResponse.json(payload, { status: backendResponse.status });
    response.cookies.set(AUTH_COOKIE_NAME, token, authCookieOptions(token));

    return response;
  } catch {
    return NextResponse.json({ error: "Unable to process login request" }, { status: 500 });
  }
}
