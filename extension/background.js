import { AUTH_CONFIG } from "./config.js";

const SESSION_TOKEN_KEY = "memoryfeed_session_token";

function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  try {
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

function buildGoogleAuthUrl({ clientId, redirectUri, state, nonce }) {
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "id_token");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "select_account");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  return authUrl.toString();
}

async function exchangeIdToken(idToken) {
  const response = await fetch(`${AUTH_CONFIG.apiBaseUrl}/api/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = await response.json();
  if (!response.ok || !body?.token) {
    throw new Error(body?.error || "AUTH_EXCHANGE_FAILED");
  }
  await chrome.storage.local.set({ [SESSION_TOKEN_KEY]: body.token });
  return body.user ?? null;
}

async function getStoredToken() {
  const result = await chrome.storage.local.get([SESSION_TOKEN_KEY]);
  return result[SESSION_TOKEN_KEY] || "";
}

async function fetchMe() {
  const token = await getStoredToken();
  if (!token) return null;
  const response = await fetch(`${AUTH_CONFIG.apiBaseUrl}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok || !body?.user) return null;
  return body.user;
}

async function logout() {
  const token = await getStoredToken();
  if (token) {
    await fetch(`${AUTH_CONFIG.apiBaseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  }
  await chrome.storage.local.remove([SESSION_TOKEN_KEY]);
}

async function login() {
  if (!AUTH_CONFIG.googleClientId || AUTH_CONFIG.googleClientId.startsWith("REPLACE_WITH")) {
    throw new Error("MISSING_GOOGLE_CLIENT_ID");
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const state = randomString(24);
  const nonce = randomString(24);
  const url = buildGoogleAuthUrl({
    clientId: AUTH_CONFIG.googleClientId,
    redirectUri,
    state,
    nonce,
  });

  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    interactive: true,
    url,
  });
  if (!redirectedTo) throw new Error("AUTH_REDIRECT_FAILED");

  const redirected = new URL(redirectedTo);
  const hash = redirected.hash.startsWith("#") ? redirected.hash.slice(1) : redirected.hash;
  const params = new URLSearchParams(hash);
  const returnedState = params.get("state");
  const idToken = params.get("id_token");
  if (!idToken || returnedState !== state) throw new Error("AUTH_RESPONSE_INVALID");

  const payload = decodeJwtPayload(idToken);
  if (!payload || payload.nonce !== nonce) throw new Error("AUTH_NONCE_MISMATCH");
  return exchangeIdToken(idToken);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = message?.action;
  if (!action) {
    sendResponse({ ok: false, error: "ACTION_REQUIRED" });
    return;
  }

  (async () => {
    if (action === "login") {
      const user = await login();
      sendResponse({ ok: true, user });
      return;
    }
    if (action === "me") {
      const user = await fetchMe();
      sendResponse({ ok: true, user });
      return;
    }
    if (action === "logout") {
      await logout();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "UNKNOWN_ACTION" });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
  });

  return true;
});
