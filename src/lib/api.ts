import { getAuthToken } from "@/lib/auth-session";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const authToken = getAuthToken();
  if (authToken) headers.set("authorization", `Bearer ${authToken}`);
  return fetch(input, { ...init, headers });
}

export async function readJson<T extends JsonValue | Record<string, unknown>>(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {} as T;
  return (await res.json()) as T;
}
