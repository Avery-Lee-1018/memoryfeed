const AUTH_TOKEN_STORAGE_KEY = "memoryfeed_auth_token";

export type AuthUser = {
  id: number;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export function getAuthToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? "";
}

export function setAuthToken(token: string) {
  if (typeof window === "undefined") return;
  if (!token) {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

function authHeaders() {
  const token = getAuthToken();
  const headers: HeadersInit = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function loginWithGoogleIdToken(idToken: string) {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const data = (await res.json()) as {
    token?: string;
    user?: AuthUser;
    error?: string;
  };
  if (!res.ok || !data.token || !data.user) {
    throw new Error(data.error || "AUTH_FAILED");
  }
  setAuthToken(data.token);
  return data.user;
}

export async function fetchMe() {
  const res = await fetch("/api/auth/me", {
    headers: {
      ...authHeaders(),
    },
  });
  const data = (await res.json()) as { user?: AuthUser; error?: string };
  if (!res.ok || !data.user) return null;
  return data.user;
}

export async function logout() {
  const token = getAuthToken();
  if (!token) return;
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: {
      ...authHeaders(),
    },
  });
  setAuthToken("");
}

export async function deleteAccount() {
  const res = await fetch("/api/auth/account", {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  setAuthToken("");
  return res.ok;
}
