const ADMIN_KEY_STORAGE = "memoryfeed_admin_key";
const ADMIN_HEADER = "x-memoryfeed-key";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function getAdminKey() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ADMIN_KEY_STORAGE)?.trim() ?? "";
}

export function setAdminKey(value: string) {
  if (typeof window === "undefined") return;
  if (!value.trim()) {
    localStorage.removeItem(ADMIN_KEY_STORAGE);
    return;
  }
  localStorage.setItem(ADMIN_KEY_STORAGE, value.trim());
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const key = getAdminKey();
  if (key) headers.set(ADMIN_HEADER, key);
  const response = await fetch(input, { ...init, headers });

  if (response.status !== 401) return response;

  const entered = typeof window !== "undefined"
    ? window.prompt("관리 키를 입력해 주세요 (Cloudflare ADMIN_TOKEN)")
    : null;
  if (!entered) return response;

  setAdminKey(entered);
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set(ADMIN_HEADER, entered.trim());
  return fetch(input, { ...init, headers: retryHeaders });
}

export async function readJson<T extends JsonValue | Record<string, unknown>>(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {} as T;
  return (await res.json()) as T;
}
