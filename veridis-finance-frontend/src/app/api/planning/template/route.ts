import { NextResponse } from "next/server";

import { getAuthTokenFromCookies } from "@/lib/auth";
import { backendUrl } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendResponse = await fetch(backendUrl("/api/planning/template"), {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!backendResponse.ok) {
    return NextResponse.json({ error: "No disponible" }, { status: backendResponse.status });
  }

  const buffer = await backendResponse.arrayBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="plantilla-planeacion.xlsx"',
    },
  });
}
