const API_URL = process.env.VERIDIS_API_URL || "http://127.0.0.1:4000";

export function backendUrl(path: string) {
  return `${API_URL}${path}`;
}

export async function parseBackendBody(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
