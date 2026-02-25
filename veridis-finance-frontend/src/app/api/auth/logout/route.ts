import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, clearCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", clearCookieOptions());
  return response;
}
