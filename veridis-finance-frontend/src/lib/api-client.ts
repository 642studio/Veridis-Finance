import type { ApiErrorEnvelope } from "@/types/finance";

export class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text ? { error: text } : {};
}

export async function clientApiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const body = await parseResponse(response);

  if (!response.ok) {
    const errorBody = body as ApiErrorEnvelope;
    const message = errorBody?.error || "Request failed";
    throw new ApiClientError(message, response.status);
  }

  return body as T;
}
