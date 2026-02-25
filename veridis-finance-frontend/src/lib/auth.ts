import { cookies } from "next/headers";

import type { SessionClaims } from "@/types/finance";

export const AUTH_COOKIE_NAME = "vf_token";
const FALLBACK_MAX_AGE_SECONDS = 60 * 60 * 8;

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function decodeJwtClaims(token?: string | null): SessionClaims | null {
  if (!token) {
    return null;
  }

  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const rawPayload = decodeBase64Url(segments[1]);
    const payload = JSON.parse(rawPayload) as Partial<SessionClaims>;

    if (
      !payload ||
      typeof payload.user_id !== "string" ||
      typeof payload.organization_id !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }

    return {
      user_id: payload.user_id,
      organization_id: payload.organization_id,
      role: payload.role as SessionClaims["role"],
      exp: payload.exp,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}

export function maxAgeFromToken(token?: string | null): number {
  const claims = decodeJwtClaims(token);
  if (!claims?.exp) {
    return FALLBACK_MAX_AGE_SECONDS;
  }

  const secondsRemaining = claims.exp - Math.floor(Date.now() / 1000);
  if (secondsRemaining <= 0) {
    return 1;
  }

  return secondsRemaining;
}

export function authCookieOptions(token?: string | null) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeFromToken(token),
  };
}

export function clearCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(0),
  };
}

export function getAuthTokenFromCookies() {
  return cookies().get(AUTH_COOKIE_NAME)?.value ?? null;
}

export function getSessionFromCookies() {
  return decodeJwtClaims(getAuthTokenFromCookies());
}
