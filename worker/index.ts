import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
  AUTH_JWT_SECRET?: string;
  GOOGLE_CLIENT_IDS?: string;
  EXTENSION_ORIGINS?: string;
}

type ReactionType = "keep" | "skip";
type SourceType = "rss" | "blog";
type SourceLevel = "core" | "focus" | "light";
const FEED_START_DATE = "2026-04-01";
const ENTRY_LIMIT_PER_SOURCE = 120;
const ENTRY_VALIDATE_LIMIT_PER_SOURCE = 6;
const RESURFACE_COOLDOWN_DAYS = 7;
const SOURCE_REFRESH_INTERVAL_MINUTES = 45;
const SOURCE_REFRESH_BATCH_SIZE = 4;
const MANUAL_REFRESH_COOLDOWN_SECONDS = 120;
const PREFERENCE_APPLY_SOURCE_MIN = 50;
const KOREAN_ACCEPT_LANGUAGE = "ko-KR,ko;q=0.95,en-US;q=0.7,en;q=0.6";
const CRAWLER_USER_AGENT = "Mozilla/5.0 (compatible; MemoryFeedBot/1.0)";
const ADMIN_HEADER = "x-memoryfeed-key";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

type AuthTokenPayload = JWTPayload & {
  sub: string;
  sid: string;
  email: string;
};

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cron = _event.cron ?? "";
    // Every 10 minutes: monitor replacement-requested sources and hydrate only due targets.
    ctx.waitUntil(processReplacementMonitorQueue(env));
    // Daily full sweep to keep global freshness without 10-min heavy crawl cost.
    if (cron === "17 3 * * *") {
      ctx.waitUntil(refreshAllSourcesGlobal(env));
    }
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      let sessionUserId: number | null = null;
      if (isUserScopedRoute(request.method, url.pathname)) {
        // DDL ensure-calls are idempotent — tables already exist in production (created by migrations).
        // Run them in the background so they don't block the response path.
        ctx.waitUntil(Promise.allSettled([ensureAuthTables(env), ensureUserScopedTables(env)]));
        const auth = await authenticateSession(request, env);
        if (!auth.ok) {
          return withCorsIfNeeded(request, env, json({ error: auth.error }, { status: 401 }));
        }
        sessionUserId = auth.user.id;
      }
      if (request.method === "OPTIONS" && isAuthPath(url.pathname)) {
        return buildCorsPreflight(request, env);
      }
      if (isProtectedRoute(request.method, url.pathname) && !isAuthorizedRequest(request, env)) {
        return withCorsIfNeeded(request, env, json({ error: "UNAUTHORIZED" }, { status: 401 }));
      }

      if (request.method === "GET" && url.pathname === "/api/thumbnail") {
        return handleGetThumbnail(request, url, ctx, env, sessionUserId ?? 0);
      }
      if (request.method === "GET" && url.pathname === "/api/feed/today") {
        return handleGetFeedToday(url, env, ctx, sessionUserId ?? 0);
      }
      if (request.method === "POST" && url.pathname === "/api/feed/replacement") {
        return handlePostFeedReplacement(request, env, sessionUserId ?? 0);
      }
      if (request.method === "POST" && url.pathname === "/api/reaction") {
        return handlePostReaction(request, env, sessionUserId ?? 0);
      }
      if (request.method === "GET" && url.pathname === "/api/sources") {
        return handleGetSources(env, sessionUserId ?? 0);
      }
      if (request.method === "POST" && url.pathname === "/api/sources") {
        return handlePostSources(request, env, ctx, sessionUserId ?? 0);
      }
      if (request.method === "POST" && /^\/api\/sources\/\d+\/refresh$/.test(url.pathname)) {
        const sourceId = parseInt(url.pathname.split("/")[3]);
        return handlePostSourceRefresh(sourceId, env, ctx, sessionUserId ?? 0);
      }
      if (request.method === "GET" && /^\/api\/sources\/\d+\/memos$/.test(url.pathname)) {
        const sourceId = parseInt(url.pathname.split("/")[3]);
        return handleGetSourceMemos(sourceId, env, sessionUserId ?? 0);
      }
      if (request.method === "PATCH" && /^\/api\/sources\/\d+$/.test(url.pathname)) {
        const sourceId = parseInt(url.pathname.split("/")[3]);
        return handlePatchSource(sourceId, request, env, sessionUserId ?? 0);
      }
      if (request.method === "DELETE" && /^\/api\/sources\/\d+$/.test(url.pathname)) {
        const sourceId = parseInt(url.pathname.split("/")[3]);
        return handleDeleteSource(sourceId, env, sessionUserId ?? 0);
      }
      if (request.method === "POST" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handlePostNote(itemId, request, env, sessionUserId ?? 0);
      }
      if (request.method === "GET" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handleGetNote(itemId, env, sessionUserId ?? 0);
      }
      if (request.method === "GET" && /^\/api\/items\/\d+\/related$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handleGetRelatedItemsByTag(itemId, env, sessionUserId ?? 0);
      }
      if (request.method === "POST" && /^\/api\/items\/\d+\/report$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handlePostItemReport(itemId, request, env, ctx, sessionUserId ?? 0);
      }
      if (request.method === "DELETE" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handleDeleteNote(itemId, env, sessionUserId ?? 0);
      }
      if (request.method === "GET" && url.pathname === "/api/stats/calendar") {
        return handleGetCalendar(env, sessionUserId ?? 0);
      }
      if (request.method === "DELETE" && url.pathname === "/api/auth/account") {
        const response = await handleDeleteAccount(request, env);
        return withCorsIfNeeded(request, env, response);
      }
      if (request.method === "POST" && url.pathname === "/api/auth/google") {
        const response = await handlePostAuthGoogle(request, env);
        return withCorsIfNeeded(request, env, response);
      }
      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        const response = await handleGetAuthMe(request, env);
        return withCorsIfNeeded(request, env, response);
      }
      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const response = await handlePostAuthLogout(request, env);
        return withCorsIfNeeded(request, env, response);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      return json({ error: "SERVER_ERROR", detail: message }, { status: 500 });
    }
  }
} satisfies ExportedHandler<Env>;

function isProtectedRoute(method: string, pathname: string) {
  void method;
  void pathname;
  return false;
}

function isUserScopedRoute(method: string, pathname: string) {
  if (method === "GET" && pathname === "/api/thumbnail") return true;
  if (method === "GET" && pathname === "/api/feed/today") return true;
  if (method === "POST" && pathname === "/api/feed/replacement") return true;
  if (method === "POST" && pathname === "/api/reaction") return true;
  if ((method === "GET" || method === "POST") && pathname === "/api/sources") return true;
  if (method === "POST" && /^\/api\/sources\/\d+\/refresh$/.test(pathname)) return true;
  if (method === "GET" && /^\/api\/sources\/\d+\/memos$/.test(pathname)) return true;
  if ((method === "PATCH" || method === "DELETE") && /^\/api\/sources\/\d+$/.test(pathname)) return true;
  if ((method === "GET" || method === "POST" || method === "DELETE") && /^\/api\/notes\/\d+$/.test(pathname)) return true;
  if (method === "GET" && /^\/api\/items\/\d+\/related$/.test(pathname)) return true;
  if (method === "POST" && /^\/api\/items\/\d+\/report$/.test(pathname)) return true;
  if (method === "GET" && pathname === "/api/stats/calendar") return true;
  if (method === "DELETE" && pathname === "/api/auth/account") return true;
  return false;
}

function isAuthPath(pathname: string) {
  return pathname === "/api/auth/google" || pathname === "/api/auth/me" || pathname === "/api/auth/logout" || pathname === "/api/auth/account";
}

function parseAllowedOrigins(env: Env) {
  return (env.EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  if (
    origin === "http://localhost:5173" ||
    origin === "http://127.0.0.1:5173" ||
    origin.startsWith("chrome-extension://")
  ) {
    return origin;
  }

  const allowed = parseAllowedOrigins(env);
  if (allowed.includes(origin)) return origin;
  return null;
}

function buildCorsHeaders(request: Request, env: Env) {
  const origin = resolveCorsOrigin(request, env);
  if (!origin) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-memoryfeed-key",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function withCorsIfNeeded(request: Request, env: Env, response: Response) {
  if (!isAuthPath(new URL(request.url).pathname)) return response;
  const corsHeaders = buildCorsHeaders(request, env);
  if (!corsHeaders) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function buildCorsPreflight(request: Request, env: Env) {
  const corsHeaders = buildCorsHeaders(request, env);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders });
}

function isAuthorizedRequest(request: Request, env: Env) {
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected) return true;
  const headerToken = request.headers.get(ADMIN_HEADER)?.trim();
  const authHeader = request.headers.get("authorization")?.trim();
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const provided = headerToken || bearerToken;
  return provided === expected;
}

function normalizeHost(host: string) {
  return host.toLowerCase().replace(/^www\./, "");
}

function isHostRelated(hostA: string, hostB: string) {
  const a = normalizeHost(hostA);
  const b = normalizeHost(hostB);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function isPrivateIPv4(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map((v) => Number(v));
  if (octets.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isDisallowedHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    isPrivateIPv4(host)
  );
}

function isPublicHttpUrl(candidateUrl: string) {
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (isDisallowedHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function isAllowedSourcePageUrl(targetUrl: string, env: Env, userId: number) {
  // Check by exact item URL — avoids false negatives when source feed URL
  // is hosted on a different domain than article URLs (e.g. Feedburner CDNs).
  const row = await env.DB.prepare(`
    SELECT 1 FROM items i
    JOIN user_sources us ON us.source_id = i.source_id
    WHERE us.user_id = ? AND us.is_active = 1 AND i.url = ?
    LIMIT 1
  `).bind(userId, targetUrl).first();
  return row !== null;
}

async function handleGetThumbnail(request: Request, url: URL, ctx: ExecutionContext, env: Env, userId: number) {
  const pageUrl = url.searchParams.get("pageUrl");
  const imageUrl = url.searchParams.get("imageUrl");

  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
    return new Response("Bad Request", { status: 400 });
  }
  if (!(await isAllowedSourcePageUrl(pageUrl, env, userId))) {
    return new Response("Forbidden", { status: 403 });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // 1) Prefer explicit imageUrl if provided and reachable.
  if (imageUrl && isPublicHttpUrl(imageUrl)) {
    const direct = await fetchImage(imageUrl, pageUrl);
    if (direct) {
      ctx.waitUntil(cache.put(cacheKey, direct.clone()));
      return direct;
    }
  }

  // 1b) YouTube — derive thumbnail directly from the video ID.
  //     Avoids fetching the full page HTML just to find the og:image.
  const ytVideoId = extractYouTubeVideoId(pageUrl);
  if (ytVideoId) {
    // Try maxresdefault first, fall back to hqdefault (always exists).
    for (const quality of ["maxresdefault", "hqdefault"]) {
      const ytThumb = `https://img.youtube.com/vi/${ytVideoId}/${quality}.jpg`;
      const ytResult = await fetchImage(ytThumb, pageUrl);
      if (ytResult) {
        ctx.waitUntil(cache.put(cacheKey, ytResult.clone()));
        return ytResult;
      }
    }
  }

  // 2) Resolve OG/Twitter image from page HTML.
  const pageRes = await fetch(pageUrl, {
    headers: buildCrawlerHeaders("text/html,application/xhtml+xml"),
    cf: {
      cacheEverything: true,
      cacheTtl: 60 * 30
    }
  });

  if (pageRes.ok) {
    const contentType = pageRes.headers.get("content-type") || "";
    if (contentType.startsWith("image/") && pageRes.body) {
      return new Response(pageRes.body, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=43200"
        }
      });
    }

    if (contentType.includes("text/html")) {
      const html = await pageRes.text();
      const ogImage = extractMetaImage(html, pageUrl);
      if (ogImage) {
        const ogResult = await fetchImage(ogImage, pageUrl);
        if (ogResult) {
          ctx.waitUntil(cache.put(cacheKey, ogResult.clone()));
          return ogResult;
        }
      }
      const inlineImage = extractFirstContentImage(html, pageUrl);
      if (inlineImage) {
        const inlineResult = await fetchImage(inlineImage, pageUrl);
        if (inlineResult) {
          ctx.waitUntil(cache.put(cacheKey, inlineResult.clone()));
          return inlineResult;
        }
      }
    }
  }

  // Last fallback: site favicon — but only when the page itself was reachable.
  // If the page returned a non-2xx status (dead link, 404) we skip favicon so
  // the caller receives a 404 and FeedCard falls back to a placeholder instead
  // of showing a tiny site icon that looks like a broken card.
  if (pageRes.ok) {
    try {
      const faviconUrl = new URL("/favicon.ico", pageUrl).toString();
      const favicon = await fetchImage(faviconUrl, pageUrl);
      if (favicon) {
        ctx.waitUntil(cache.put(cacheKey, favicon.clone()));
        return favicon;
      }
    } catch {
      // no-op
    }
  }

  // If thumbnail extraction fails repeatedly, schedule a guarded source rehydrate
  // so future cards can recover richer metadata instead of staying on fallback.
  ctx.waitUntil(triggerSourceRehydrateForPageUrl(pageUrl, env, userId));
  return new Response("Not Found", { status: 404 });
}

async function fetchImage(targetUrl: string, referer?: string) {
  if (!isPublicHttpUrl(targetUrl)) return null;
  const upstream = await fetch(targetUrl, {
    headers: buildCrawlerHeaders("image/avif,image/webp,image/apng,image/*,*/*;q=0.8", referer),
    cf: {
      cacheEverything: true,
      cacheTtl: 60 * 60 * 12
    }
  });

  const contentType = upstream.headers.get("content-type") || "";
  if (!upstream.ok || !upstream.body || !contentType.startsWith("image/")) {
    return null;
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=43200"
    }
  });
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = parsed.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      // /shorts/{id}
      const shorts = parsed.pathname.match(/^\/shorts\/([\w-]{11})$/);
      if (shorts) return shorts[1];
    }
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      if (id && /^[\w-]{11}$/.test(id)) return id;
    }
    return null;
  } catch {
    return null;
  }
}

function extractMetaImage(html: string, pageUrl: string): string | null {
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i);
  const twMatch =
    html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i);

  const found = ogMatch?.[1] || twMatch?.[1];
  if (!found) return null;

  try {
    return new URL(found, pageUrl).toString();
  } catch {
    return null;
  }
}

function extractFirstContentImage(html: string, pageUrl: string): string | null {
  const imgTags = html.match(/<img[^>]*>/gi) || [];
  for (const tag of imgTags) {
    const candidate = getAttr(tag, "src") || getAttr(tag, "data-src");
    if (!candidate) continue;
    const normalized = normalizeEntryUrl(candidate, pageUrl);
    if (!normalized || !isPublicHttpUrl(normalized)) continue;
    const lower = normalized.toLowerCase();
    if (
      lower.includes("favicon") ||
      lower.includes("/icon") ||
      lower.includes("sprite") ||
      lower.includes("logo")
    ) {
      continue;
    }
    return normalized;
  }
  return null;
}

function buildCrawlerHeaders(accept: string, referer?: string) {
  return {
    "user-agent": CRAWLER_USER_AGENT,
    accept,
    "accept-language": KOREAN_ACCEPT_LANGUAGE,
    ...(referer ? { referer } : {}),
  };
}

function getDateParamOrToday(value: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = !value ? today : (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today);
  if (parsed < FEED_START_DATE) return FEED_START_DATE;
  return parsed;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureFeedSlotsTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_feed_slots (
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      slot_index INTEGER NOT NULL CHECK (slot_index IN (0, 1, 2)),
      item_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, date, slot_index),
      UNIQUE (user_id, date, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_user_feed_slots_user_date ON user_feed_slots(user_id, date)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_user_feed_slots_user_source_date ON user_feed_slots(user_id, source_id, date)").run();
}

async function handleGetFeedToday(url: URL, env: Env, ctx: ExecutionContext, userId: number) {
  // DDL and one-time cleanup tasks don't block the response — run them in background.
  ctx.waitUntil(Promise.allSettled([
    ensureFeedSlotsTable(env),
    cleanupDemoData(env),
    cleanupLegacyDisplayArtifacts(env),
    cleanupWeakNumericTitles(env),
  ]));
  const targetDate = getDateParamOrToday(url.searchParams.get("date"));
  await ensureUserSourcesSeeded(env, userId);
  await pruneDateAssetLikeSlots(targetDate, env, userId);
  await ensureDateHasThreeSlots(targetDate, env, userId);
  let result = await queryDistinctDateItems(targetDate, env, userId);
  const quickRows = (result.results ?? []) as Record<string, unknown>[];
  if (quickRows.length >= 3) {
    ctx.waitUntil((async () => {
      await pruneDateItemsDuplicatedAcrossOtherDates(env, userId, targetDate);
      await pruneDateContentDuplicatesByKey(env, userId, targetDate);
      await Promise.allSettled([
        ensureItemsFromSources(env, ctx, userId),
        refreshStaleSourcesInBackground(env, userId),
        ensureThumbnailsForShownItems(quickRows, env),
      ]);
      await backfillFeedsUntilDate(targetDate, env, userId);
    })());
    const finalQuickItems = quickRows.map(({ sourceId, ...rest }) => rest);
    return json({ date: targetDate, items: finalQuickItems.map(sanitizeFeedItemText) });
  }

  await pruneDateItemsDuplicatedAcrossOtherDates(env, userId, targetDate);
  await pruneDateContentDuplicatesByKey(env, userId, targetDate);
  await ensureItemsFromSources(env, ctx, userId);
  ctx.waitUntil(refreshStaleSourcesInBackground(env, userId));
  await backfillFeedsUntilDate(targetDate, env, userId);
  result = await queryDistinctDateItems(targetDate, env, userId);

  const items = (result.results ?? []) as Record<string, unknown>[];

  // Always guarantee 3 items — prioritize source diversity for the same date.
  if (items.length < 3) {
    await fillDateIfNeeded(targetDate, env, userId);
    result = await queryDistinctDateItems(targetDate, env, userId);
  }

  let rows = (result.results ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    await recoverEmptyFeedForUser(targetDate, env, userId);
    result = await queryDistinctDateItems(targetDate, env, userId);
    rows = (result.results ?? []) as Record<string, unknown>[];
  }

  ctx.waitUntil((async () => {
    await Promise.allSettled([
      rehydrateWeakShownSources(rows, env),
      rehydrateRandomWeakSource(env, userId),
      ensureThumbnailsForShownItems(rows, env),
    ]);
  })());
  const finalItems = rows.map(({ sourceId, ...rest }) => rest);
  return json({ date: targetDate, items: finalItems.map(sanitizeFeedItemText) });
}

async function ensureDateHasThreeSlots(targetDate: string, env: Env, userId: number) {
  // Defensive self-heal: if any upstream cleanup/rehydration removed cards,
  // force date slot refill before responding.
  for (let i = 0; i < 3; i += 1) {
    const current = await queryDistinctDateItems(targetDate, env, userId);
    const rows = (current.results ?? []) as Record<string, unknown>[];
    if (rows.length >= 3) return;
    await fillDateIfNeeded(targetDate, env, userId);
  }

  const finalCheck = await queryDistinctDateItems(targetDate, env, userId);
  const finalRows = (finalCheck.results ?? []) as Record<string, unknown>[];
  if (finalRows.length >= 3) return;
  await recoverEmptyFeedForUser(targetDate, env, userId);
}

async function rehydrateWeakShownSources(rows: Record<string, unknown>[], env: Env) {
  const sourceIds = [...new Set(
    rows.map((row) => Number(row.sourceId)).filter(Number.isFinite)
  )];
  for (const sourceId of sourceIds.slice(0, 2)) {
    const source = await env.DB.prepare(`
      SELECT id, name, url, type
      FROM sources
      WHERE id = ?
      LIMIT 1
    `).bind(sourceId).first<{ id: number; name: string; url: string; type: SourceType }>();
    if (!source) continue;

    const weak = await env.DB.prepare(`
      SELECT COUNT(*) AS weakCount
      FROM items
      WHERE source_id = ?
        AND (
          title IS NULL OR trim(title) = ''
          OR lower(trim(title)) = lower(trim(?))
          OR title LIKE 'http://%'
          OR title LIKE 'https://%'
          OR title LIKE '%&#%'
          OR title LIKE '%!%%' ESCAPE '!'
          OR summary LIKE '%&#%'
        )
    `).bind(sourceId, source.name).first<{ weakCount?: number }>();

    if (Number(weak?.weakCount ?? 0) <= 0) continue;
    await hydrateSourceItems(source, env);
  }
}

async function rehydrateRandomWeakSource(env: Env, userId: number) {
  const source = await env.DB.prepare(`
    SELECT s.id, s.name, s.url, s.type
    FROM user_sources us
    JOIN sources s ON s.id = us.source_id
    JOIN items i ON i.source_id = s.id
    WHERE us.user_id = ?
      AND us.is_active = 1
      AND (
        i.title IS NULL OR trim(i.title) = ''
        OR lower(trim(i.title)) = lower(trim(s.name))
        OR i.title LIKE 'http://%'
        OR i.title LIKE 'https://%'
        OR i.title LIKE '%&#%'
        OR i.title LIKE '%!%%' ESCAPE '!'
        OR i.summary LIKE '%&#%'
        OR trim(COALESCE(i.summary, '')) IN ('*', '-')
      )
    ORDER BY RANDOM()
    LIMIT 1
  `).bind(userId).first<{ id: number; name: string; url: string; type: SourceType }>();

  if (!source) return;
  await hydrateSourceItems(source, env);
}

async function queryDistinctDateItems(targetDate: string, env: Env, userId: number) {
  return env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType, us.level AS sourceLevel,
           i.source_id AS sourceId,
           CASE WHEN n.id IS NULL THEN 0 ELSE 1 END AS hasNote,
           fs.slot_index AS slotIndex
    FROM user_feed_slots fs
    JOIN items i ON i.id = fs.item_id
    JOIN sources s ON s.id = i.source_id
    JOIN user_sources us ON us.user_id = fs.user_id AND us.source_id = s.id
    LEFT JOIN user_notes n ON n.item_id = i.id AND n.user_id = fs.user_id
    WHERE fs.date = ?
      AND fs.user_id = ?
      AND i.status = 'active'
      AND us.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM user_hidden_items uhi
        WHERE uhi.user_id = fs.user_id
          AND uhi.date = fs.date
          AND uhi.item_id = fs.item_id
      )
      AND ${buildSqlAssetExclusion("i")}
    ORDER BY fs.slot_index ASC
    LIMIT 3
  `).bind(targetDate, userId).all();
}

async function handlePostFeedReplacement(request: Request, env: Env, userId: number) {
  await ensureFeedSlotsTable(env);
  let body: { excludeItemIds?: number[]; date?: string; replaceItemId?: number };
  try {
    body = (await request.json()) as { excludeItemIds?: number[]; date?: string; replaceItemId?: number };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const excludeItemIds = Array.isArray(body.excludeItemIds)
    ? body.excludeItemIds.filter((id): id is number => Number.isInteger(id))
    : [];

  const targetDate = getDateParamOrToday(body.date ?? null);

  const slot = Number.isInteger(body.replaceItemId)
    ? await env.DB.prepare(`
      SELECT slot_index
      FROM user_feed_slots
      WHERE user_id = ? AND date = ? AND item_id = ?
      LIMIT 1
    `).bind(userId, targetDate, body.replaceItemId).first<{ slot_index: number }>()
    : null;
  if (!slot) {
    return json({ item: null, reason: "item_not_in_today_slots" });
  }

  if (Number.isInteger(body.replaceItemId)) {
    await hideItemForDate(env, userId, targetDate, Number(body.replaceItemId));
  }

  const replacedItemMeta = Number.isInteger(body.replaceItemId)
    ? await env.DB.prepare(`
      SELECT id, source_id, title, url
      FROM items
      WHERE id = ?
      LIMIT 1
    `).bind(body.replaceItemId).first<{ id: number; source_id: number; title: string; url: string }>()
    : null;
  const blockedDedupKey = replacedItemMeta
    ? buildContentDedupKey(
      Number(replacedItemMeta.source_id),
      String(replacedItemMeta.title ?? ""),
      String(replacedItemMeta.url ?? ""),
    )
    : "";

  const todayRows = await env.DB.prepare(`
    SELECT item_id, source_id
    FROM user_feed_slots
    WHERE user_id = ? AND date = ?
  `).bind(userId, targetDate).all();
  const todayItems = ((todayRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.item_id))
    .filter(Number.isFinite);
  const todaySources = ((todayRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.source_id))
    .filter(Number.isFinite);

  const fatigueRows = await env.DB.prepare(`
    SELECT DISTINCT source_id
    FROM user_feed_slots
    WHERE user_id = ?
      AND date < ?
      AND date >= date(?, '-3 day')
  `).bind(userId, targetDate, targetDate).all();
  const fatiguedSources = ((fatigueRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.source_id))
    .filter(Number.isFinite);

  const excludedIds = [...new Set([...excludeItemIds, ...todayItems])];
  const excludedSources = [...new Set([...todaySources, ...fatiguedSources])];

  let replacementId: number | null = null;

  const preferred = await selectCandidateItemIds(env, {
    userId,
    targetDate,
    limit: 12,
    excludeItemIds: excludedIds,
    excludeSourceIds: excludedSources,
    requireNoMemo: true,
    distinctBySource: false,
  });
  if (preferred.length > 0) {
    replacementId = await pickFirstNonDuplicateByKey(env, preferred, blockedDedupKey);
  }

  if (!replacementId) {
    const fallbackUnassigned = await selectCandidateItemIds(env, {
      userId,
      targetDate,
      limit: 12,
      excludeItemIds: excludedIds,
      excludeSourceIds: todaySources,
      requireNoMemo: true,
      distinctBySource: false,
    });
    if (fallbackUnassigned.length > 0) {
      replacementId = await pickFirstNonDuplicateByKey(env, fallbackUnassigned, blockedDedupKey);
    }
  }

  if (!replacementId) {
    // Last-resort: allow memoed items, but keep cross-date uniqueness.
    const fallbackAny = await selectCandidateItemIds(env, {
      userId,
      targetDate,
      limit: 12,
      excludeItemIds: excludedIds,
      excludeSourceIds: [],
      requireNoMemo: false,
      distinctBySource: false,
    });
    if (fallbackAny.length > 0) {
      replacementId = await pickFirstNonDuplicateByKey(env, fallbackAny, blockedDedupKey);
    }
  }

  if (!replacementId) {
    const emergencyNeverShown = await selectEmergencyNeverShownItemId(
      env,
      userId,
      targetDate,
      excludedIds,
      todaySources,
      blockedDedupKey,
    );
    if (emergencyNeverShown) replacementId = emergencyNeverShown;
  }

  if (!replacementId) {
    // Absolute final guard: pick anything active for this user (even previously shown).
    const emergencyAny = await selectEmergencyAnyItemId(env, userId, excludedIds, blockedDedupKey);
    if (emergencyAny) replacementId = emergencyAny;
  }

  if (!replacementId) {
    // Hidden slot recovery: refill today's slots and reuse whatever landed in the same slot index.
    await fillDateIfNeeded(targetDate, env, userId);
    const slotted = await env.DB.prepare(`
      SELECT item_id
      FROM user_feed_slots
      WHERE user_id = ? AND date = ? AND slot_index = ?
      LIMIT 1
    `).bind(userId, targetDate, slot.slot_index).first<{ item_id: number }>();
    if (slotted?.item_id && Number.isFinite(Number(slotted.item_id))) {
      replacementId = Number(slotted.item_id);
    }
  }

  if (replacementId) {
    const replacementSource = await env.DB.prepare("SELECT source_id FROM items WHERE id = ? LIMIT 1")
      .bind(replacementId)
      .first<{ source_id: number }>();
    if (!replacementSource) return json({ item: null });

    await env.DB.prepare(`
      UPDATE user_feed_slots
      SET item_id = ?, source_id = ?
      WHERE user_id = ? AND date = ? AND slot_index = ?
    `)
      .bind(replacementId, replacementSource.source_id, userId, targetDate, slot.slot_index)
      .run();
  }

  if (!replacementId) return json({ item: null, reason: "replacement_unavailable" });

  // Monitor the replaced source in the background every 10 minutes for a while
  // so future replacement requests can find richer content.
  if (replacedItemMeta?.source_id) {
    await enqueueReplacementMonitor(env, userId, replacedItemMeta.source_id, replacedItemMeta.url);
  }

  const finalReplacement = await env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType, us.level AS sourceLevel,
           CASE WHEN n.id IS NULL THEN 0 ELSE 1 END AS hasNote
    FROM items i
    JOIN sources s ON i.source_id = s.id
    JOIN user_sources us ON us.user_id = ? AND us.source_id = s.id
    LEFT JOIN user_notes n ON n.item_id = i.id AND n.user_id = ?
    WHERE i.id = ?
    LIMIT 1
  `).bind(userId, userId, replacementId).first();
  return json({ item: finalReplacement ? sanitizeFeedItemText(finalReplacement as Record<string, unknown>) : null });
}

async function selectEmergencyNeverShownItemId(
  env: Env,
  userId: number,
  targetDate: string,
  excludeItemIds: number[],
  preferredExcludeSourceIds: number[],
  blockedDedupKey: string,
) {
  const itemExclusion = buildInClause("i.id", excludeItemIds);
  const sourceExclusion = buildInClause("i.source_id", preferredExcludeSourceIds);
  const query = async (withSourceExclusion: boolean) => {
    const rows = await env.DB.prepare(`
      SELECT i.id
      FROM items i
      JOIN user_sources us ON us.user_id = ? AND us.source_id = i.source_id AND us.is_active = 1
      JOIN sources s ON s.id = i.source_id
      LEFT JOIN user_notes n ON n.user_id = ? AND n.item_id = i.id
      WHERE i.status = 'active'
        AND ${buildSqlAssetExclusion("i")}
        AND RTRIM(i.url, '/') != RTRIM(s.url, '/')
        AND (n.content IS NULL OR trim(n.content) = '')
        AND NOT EXISTS (
          SELECT 1
          FROM user_feed_slots fs
          WHERE fs.user_id = ? AND fs.item_id = i.id
        )
        ${itemExclusion.sql}
        ${withSourceExclusion ? sourceExclusion.sql : ""}
      ORDER BY i.id DESC
      LIMIT 20
    `).bind(
      userId,
      userId,
      userId,
      ...itemExclusion.params,
      ...(withSourceExclusion ? sourceExclusion.params : []),
    ).all<{ id: number }>();
    const ids = (rows.results ?? []).map((r) => Number(r.id)).filter(Number.isFinite);
    return await pickFirstNonDuplicateByKey(env, ids, blockedDedupKey);
  };

  const preferred = await query(true);
  if (preferred) return preferred;

  // Try refreshing user sources once and retry.
  await ensureItemsFromSources(env, undefined, userId);
  await fillDateIfNeeded(targetDate, env, userId);
  return await query(false);
}

async function selectEmergencyAnyItemId(
  env: Env,
  userId: number,
  excludeItemIds: number[],
  blockedDedupKey: string,
) {
  const itemExclusion = buildInClause("i.id", excludeItemIds);
  const rows = await env.DB.prepare(`
    SELECT i.id
    FROM items i
    JOIN user_sources us ON us.user_id = ? AND us.source_id = i.source_id AND us.is_active = 1
    JOIN sources s ON s.id = i.source_id
    WHERE i.status = 'active'
      AND ${buildSqlAssetExclusion("i")}
      AND RTRIM(i.url, '/') != RTRIM(s.url, '/')
      ${itemExclusion.sql}
    ORDER BY i.id DESC
    LIMIT 30
  `).bind(userId, ...itemExclusion.params).all<{ id: number }>();
  const ids = (rows.results ?? []).map((r) => Number(r.id)).filter(Number.isFinite);
  return await pickFirstNonDuplicateByKey(env, ids, blockedDedupKey);
}

async function pickFirstNonDuplicateByKey(env: Env, candidateIds: number[], blockedDedupKey: string) {
  if (candidateIds.length === 0) return null;
  if (!blockedDedupKey) return candidateIds[0] ?? null;
  const metaMap = await fetchItemMetaForItems(env, candidateIds);
  for (const id of candidateIds) {
    const meta = metaMap.get(id);
    if (!meta) continue;
    const key = buildContentDedupKey(meta.sourceId, meta.title, meta.url);
    if (key !== blockedDedupKey) return id;
  }
  return null;
}

async function handleGetSourceMemos(sourceId: number, env: Env, userId: number) {
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return json({ error: "INVALID_SOURCE_ID" }, { status: 400 });
  }

  const source = await env.DB.prepare(`
    SELECT s.id, s.name
    FROM user_sources us
    JOIN sources s ON s.id = us.source_id
    WHERE us.user_id = ? AND us.source_id = ?
    LIMIT 1
  `).bind(userId, sourceId).first<{ id: number; name: string }>();

  if (!source) {
    return json({ error: "SOURCE_NOT_FOUND" }, { status: 404 });
  }

  const result = await env.DB.prepare(`
    WITH shown AS (
      SELECT fs.item_id, MAX(fs.date) AS lastShownDate
      FROM user_feed_slots fs
      WHERE fs.user_id = ? AND fs.source_id = ?
      GROUP BY fs.item_id
    )
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType, us.level AS sourceLevel,
           CASE WHEN n.id IS NULL OR trim(COALESCE(n.content, '')) = '' THEN 0 ELSE 1 END AS hasNote
    FROM shown sh
    JOIN items i ON i.id = sh.item_id
    JOIN sources s ON s.id = i.source_id
    JOIN user_sources us ON us.user_id = ? AND us.source_id = s.id
    LEFT JOIN user_notes n ON n.user_id = ? AND n.item_id = i.id
    WHERE i.source_id = ?
      AND i.status = 'active'
    ORDER BY sh.lastShownDate DESC, i.id DESC
    LIMIT 180
  `).bind(userId, sourceId, userId, userId, sourceId).all();

  const items = ((result.results ?? []) as Record<string, unknown>[]).map(sanitizeFeedItemText);
  return json({
    source: { id: source.id, name: source.name },
    items,
  });
}

async function handlePostReaction(request: Request, env: Env, userId: number) {
  let body: { itemId?: number; type?: ReactionType; reason?: string };
  try {
    body = (await request.json()) as { itemId?: number; type?: ReactionType; reason?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.itemId !== "number" || !body.type) {
    return json({ error: "itemId and type are required" }, { status: 400 });
  }
  if (!["keep", "skip"].includes(body.type)) {
    return json({ error: "type must be keep | skip" }, { status: 400 });
  }
  if (body.type === "skip" && body.reason && !["resurface_later", "not_my_interest"].includes(body.reason)) {
    return json({ error: "reason must be resurface_later | not_my_interest" }, { status: 400 });
  }

  const itemExists = await env.DB.prepare("SELECT id, source_id, title, url FROM items WHERE id = ? LIMIT 1")
    .bind(body.itemId).first<{ id: number; source_id: number; title: string; url: string }>();
  if (!itemExists) return json({ error: "item not found" }, { status: 404 });

  await env.DB.prepare("INSERT INTO user_reactions (user_id, item_id, type) VALUES (?, ?, ?)")
    .bind(userId, body.itemId, body.type).run();

  if (body.type === "skip" && body.reason === "not_my_interest") {
    const sourceCountRow = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM user_sources WHERE user_id = ? AND is_active = 1
    `).bind(userId).first<{ count?: number }>();
    const activeSourceCount = Number(sourceCountRow?.count ?? 0);
    if (activeSourceCount >= PREFERENCE_APPLY_SOURCE_MIN) {
      await env.DB.prepare(`
        INSERT INTO user_source_penalties (user_id, source_id, score, updated_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, source_id) DO UPDATE SET
          score = MIN(8, user_source_penalties.score + 1),
          updated_at = CURRENT_TIMESTAMP
      `).bind(userId, Number(itemExists.source_id)).run();

      const signals = extractSignalFromItem(String(itemExists.title ?? ""), "", String(itemExists.url ?? ""));
      for (const tag of signals.tags) {
        await env.DB.prepare(`
          INSERT INTO user_tag_penalties (user_id, tag, score, updated_at)
          VALUES (?, ?, 0.5, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, tag) DO UPDATE SET
            score = MIN(6, user_tag_penalties.score + 0.5),
            updated_at = CURRENT_TIMESTAMP
        `).bind(userId, tag).run();
      }
      await env.DB.prepare(`
        INSERT INTO user_topic_penalties (user_id, topic, score, updated_at)
        VALUES (?, ?, 0.7, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, topic) DO UPDATE SET
          score = MIN(6, user_topic_penalties.score + 0.7),
          updated_at = CURRENT_TIMESTAMP
      `).bind(userId, signals.topic).run();
    }
  }

  return json({ ok: true });
}

type ReportIssue = "thumbnail" | "title" | "summary" | "url";

async function handlePostItemReport(
  itemId: number,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  userId: number,
) {
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return json({ error: "INVALID_ITEM_ID" }, { status: 400 });
  }

  let body: { issues?: ReportIssue[]; details?: string };
  try {
    body = (await request.json()) as { issues?: ReportIssue[]; details?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowedIssues = new Set<ReportIssue>(["thumbnail", "title", "summary", "url"]);
  const issues = new Set<ReportIssue>(
    (body.issues ?? []).filter((v): v is ReportIssue => allowedIssues.has(v as ReportIssue))
  );
  const details = String(body.details ?? "").trim().slice(0, 800);
  const hintedIssues = deriveIssueHintsFromDetails(details);
  hintedIssues.forEach((issue) => issues.add(issue));
  if (issues.size === 0 && details.length === 0) {
    return json({ error: "At least one issue or details is required" }, { status: 400 });
  }

  // Verify the item belongs to one of this user's active sources
  const item = await env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url, i.source_id
    FROM items i
    JOIN user_sources us ON us.source_id = i.source_id AND us.user_id = ?
    WHERE i.id = ? AND i.status = 'active'
    LIMIT 1
  `).bind(userId, itemId).first<{
    id: number; title: string; url: string;
    summary: string | null; thumbnail_url: string | null; source_id: number;
  }>();

  if (!item) return json({ error: "item not found" }, { status: 404 });

  await enqueueReplacementMonitor(env, userId, item.source_id, item.url);

  // --- Attempt to re-fetch and repair ---
  const html = await fetchSourceText(item.url, "text/html,application/xhtml+xml");

  // If the page is dead (404 / unreachable) deactivate it immediately.
  if (!html) {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = ?")
      .bind(itemId).run();
    return json({ repaired: false, reason: "page_unreachable" });
  }

  // Check for soft-404 (page returns 200 but content is an error page)
  if (isLikelyErrorPage(html, item.url)) {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = ?")
      .bind(itemId).run();
    return json({ repaired: false, reason: "error_page_detected" });
  }

  // If url issue was the only complaint but the page loaded fine, the link is OK.
  // Re-extract metadata for whichever fields were reported as broken.
  let newTitle = item.title;
  let newSummary = item.summary;
  let newThumbnail = item.thumbnail_url;
  let anyFixed = false;

  if (issues.has("title") || issues.has("summary") || issues.has("thumbnail")) {
    if (issues.has("title")) {
      const htmlTitle = normalizeDisplayText(
        (extractHtmlTitle(html) ?? "").replace(/\|\s*Substack.*$/i, "").trim()
      );
      const metaTitle = normalizeDisplayText(extractMetaTitle(html) ?? "");
      const candidate = (htmlTitle && !isWeakEntryTitle(htmlTitle, "")) ? htmlTitle
        : (metaTitle && !isWeakEntryTitle(metaTitle, "")) ? metaTitle
        : null;
      if (candidate && candidate !== item.title) {
        newTitle = candidate;
        anyFixed = true;
      }
    }

    if (issues.has("summary")) {
      const metaDesc = normalizeDisplayText(extractMetaDescription(html) ?? "");
      if (isUsableSummary(metaDesc) && metaDesc !== item.summary) {
        newSummary = metaDesc;
        anyFixed = true;
      }
    }

    if (issues.has("thumbnail")) {
      const metaImage = extractMetaImage(html, item.url);
      const inlineImage = metaImage ? null : extractFirstContentImage(html, item.url);
      const candidate = metaImage || inlineImage;
      if (candidate && candidate !== item.thumbnail_url) {
        newThumbnail = candidate;
        anyFixed = true;
      }
    }
  }

  // Persist any improvements found
  if (anyFixed) {
    await env.DB.prepare(`
      UPDATE items
      SET title = ?, summary = ?, thumbnail_url = ?
      WHERE id = ?
    `).bind(newTitle, newSummary, newThumbnail, itemId).run();
  }

  // Strict pass criteria: must differ from previous data to be considered repaired.
  // If nothing changed compared to the previous snapshot, it fails and is removed.
  const repaired = anyFixed;

  // Trigger a background source rehydrate so fresh content is available soon
  ctx.waitUntil(triggerSourceRehydrateForPageUrl(item.url, env, userId));

  if (!repaired) {
    // Nothing could be improved — deactivate so it won't resurface
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = ?")
      .bind(itemId).run();
    return json({ repaired: false, reason: "no_improvement_found", detailsAccepted: details.length > 0 });
  }

  return json({
    repaired: true,
    detailsAccepted: details.length > 0,
    item: {
      id: item.id,
      title: newTitle,
      url: item.url,
      summary: newSummary,
      thumbnail_url: newThumbnail,
    },
  });
}

function deriveIssueHintsFromDetails(details: string): ReportIssue[] {
  if (!details) return [];
  const lower = details.toLowerCase();
  const hints = new Set<ReportIssue>();
  if (
    lower.includes("썸네일") ||
    lower.includes("이미지") ||
    lower.includes("사진") ||
    lower.includes("thumbnail")
  ) hints.add("thumbnail");
  if (
    lower.includes("제목") ||
    lower.includes("타이틀") ||
    lower.includes("title")
  ) hints.add("title");
  if (
    lower.includes("설명") ||
    lower.includes("본문") ||
    lower.includes("요약") ||
    lower.includes("summary")
  ) hints.add("summary");
  if (
    lower.includes("링크") ||
    lower.includes("랜딩") ||
    lower.includes("404") ||
    lower.includes("url")
  ) hints.add("url");
  return [...hints];
}

async function handleGetSources(env: Env, userId: number) {
  await ensureUserSourcesSeeded(env, userId);
  await ensureSourceRefreshTable(env);
  const result = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.url,
      s.type,
      us.level,
      us.is_active,
      MAX(us.created_at) AS createdAt,
      COUNT(DISTINCT i.id) AS totalItems,
      COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) AS splitItems,
      COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') = RTRIM(s.url, '/') THEN i.id END) AS rootItems,
      COALESCE(COUNT(DISTINCT CASE WHEN fs.date IS NOT NULL THEN fs.date || ':' || fs.slot_index END), 0) AS exposureCount,
      COALESCE(COUNT(DISTINCT CASE WHEN n.content IS NOT NULL AND trim(n.content) != '' THEN n.id END), 0) AS memoCount,
      MAX(fs.date) AS lastExposedAt,
      COALESCE(
        MAX(CASE
          WHEN n.updated_at IS NOT NULL
               AND (fs.date IS NULL OR n.updated_at > fs.date)
          THEN n.updated_at
          ELSE fs.date
        END),
        MAX(fs.date),
        MAX(n.updated_at)
      ) AS lastActivityAt,
      MAX(rs.last_refreshed_at) AS lastRefreshedAt,
      CASE
        WHEN COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) >= 1 THEN 'split'
        ELSE 'single'
      END AS extractionMode,
      CASE
        WHEN COUNT(DISTINCT i.id) = 0 THEN 'NO_ITEMS'
        WHEN COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) = 0
          THEN CASE
            WHEN lower(s.url) LIKE '%longblack.co%' THEN 'BLOCKED_PATTERN'
            ELSE 'ROOT_ONLY'
          END
        WHEN COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) = 1 THEN 'ONE_SPLIT'
        ELSE 'UNKNOWN'
      END AS extractionReason,
      CASE
        WHEN COUNT(DISTINCT i.id) = 0 THEN '아직 수집된 콘텐츠가 없어요'
        WHEN COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) = 0
          THEN '홈/피드 페이지 중심으로 감지됐어요'
        WHEN COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) = 1
          THEN '분리 가능한 아티클이 1개만 감지됐어요'
        ELSE '아티클 분리 노출이 가능해요'
      END AS extractionNote
    FROM user_sources us
    JOIN sources s ON s.id = us.source_id
    LEFT JOIN items i ON i.source_id = s.id
    LEFT JOIN user_feed_slots fs ON fs.item_id = i.id AND fs.user_id = us.user_id
    LEFT JOIN user_notes n ON n.item_id = i.id AND n.user_id = us.user_id
    LEFT JOIN source_refresh_state rs ON rs.source_id = s.id
    WHERE us.user_id = ?
    GROUP BY s.id, us.level, us.is_active
    ORDER BY s.id DESC
  `).bind(userId).all();
  return json({ sources: result.results ?? [] });
}

async function handlePostSourceRefresh(sourceId: number, env: Env, ctx: ExecutionContext, userId: number) {
  void ctx;
  await ensureUserSourcesSeeded(env, userId);
  await ensureSourceRefreshTable(env);

  const source = await env.DB.prepare(`
    SELECT s.id, s.name, s.url, s.type
    FROM user_sources us
    JOIN sources s ON s.id = us.source_id
    WHERE us.user_id = ? AND us.source_id = ? AND us.is_active = 1
    LIMIT 1
  `).bind(userId, sourceId).first<{ id: number; name: string; url: string; type: SourceType }>();
  if (!source) return json({ error: "source not found" }, { status: 404 });

  const state = await env.DB.prepare(`
    SELECT last_refreshed_at AS lastRefreshedAt
    FROM source_refresh_state
    WHERE source_id = ?
    LIMIT 1
  `).bind(sourceId).first<{ lastRefreshedAt?: string }>();

  const now = Date.now();
  const lastMs = state?.lastRefreshedAt ? new Date(state.lastRefreshedAt).getTime() : 0;
  if (lastMs && Number.isFinite(lastMs) && now - lastMs < MANUAL_REFRESH_COOLDOWN_SECONDS * 1000) {
    return json({
      ok: true,
      refreshed: false,
      reason: "cooldown",
      cooldownSeconds: MANUAL_REFRESH_COOLDOWN_SECONDS,
      lastRefreshedAt: state.lastRefreshedAt,
    });
  }

  const nowIso = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO source_refresh_state (source_id, last_refreshed_at)
    VALUES (?, CURRENT_TIMESTAMP)
    ON CONFLICT(source_id) DO UPDATE SET last_refreshed_at = CURRENT_TIMESTAMP
  `).bind(sourceId).run();

  const before = await getCallableContentStatsForSource(sourceId, env);
  await hydrateSourceItems(source, env, true /* fresh — bypass CF cache */);
  const after = await getCallableContentStatsForSource(sourceId, env);
  const contentDelta = Math.max(0, after.callableCount - before.callableCount);
  const changed = contentDelta > 0;

  if (changed) {
    const todayIso = getTodayIso();
    await env.DB.prepare(`
      DELETE FROM user_feed_slots
      WHERE user_id = ? AND date = ? AND source_id = ?
    `).bind(userId, todayIso, sourceId).run();
  }

  return json({
    ok: true,
    refreshed: true,
    changed,
    contentDelta,
    beforeCallableCount: before.callableCount,
    afterCallableCount: after.callableCount,
    lastRefreshedAt: nowIso,
  });
}

async function getCallableContentStatsForSource(sourceId: number, env: Env) {
  const row = await env.DB.prepare(`
    SELECT COUNT(DISTINCT i.id) AS callableCount
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.source_id = ?
      AND i.status = 'active'
      AND RTRIM(i.url, '/') <> RTRIM(s.url, '/')
      AND ${buildSqlAssetExclusion("i")}
  `).bind(sourceId).first<{ callableCount?: number }>();
  return { callableCount: Number(row?.callableCount ?? 0) };
}

async function ensureUserSourcesSeeded(_env: Env, _userId: number) {
  // Intentionally a no-op.
  //
  // Previously this copied ALL rows from the global `sources` table into every
  // new user's user_sources on first login, which meant User B automatically
  // inherited every source that User A had ever added — a critical data-isolation
  // bug. Each user now starts with an empty source list and adds their own
  // sources through the My Sources view.
}

async function recoverEmptyFeedForUser(targetDate: string, env: Env, userId: number) {
  await ensureUserSourcesSeeded(env, userId);

  const activeCount = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM user_sources
    WHERE user_id = ? AND is_active = 1
  `).bind(userId).first<{ count?: number }>();
  if (Number(activeCount?.count ?? 0) === 0) {
    await env.DB.prepare(`
      UPDATE user_sources
      SET is_active = 1
      WHERE user_id = ?
    `).bind(userId).run();
  }

  const activeSources = await env.DB.prepare(`
    SELECT s.id, s.name, s.url, s.type
    FROM user_sources us
    JOIN sources s ON s.id = us.source_id
    WHERE us.user_id = ? AND us.is_active = 1
    ORDER BY us.created_at DESC
    LIMIT 60
  `).bind(userId).all<{ id: number; name: string; url: string; type: SourceType }>();

  for (const source of activeSources.results ?? []) {
    await seedItemForSource(source, env);
  }

  await fillDateIfNeeded(targetDate, env, userId);

  const slotCount = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM user_feed_slots
    WHERE user_id = ? AND date = ?
  `).bind(userId, targetDate).first<{ count?: number }>();
  if (Number(slotCount?.count ?? 0) > 0) return;

  const fallbackItems = await env.DB.prepare(`
    SELECT i.id AS itemId, i.source_id AS sourceId
    FROM items i
    JOIN user_sources us ON us.user_id = ? AND us.source_id = i.source_id
    WHERE us.is_active = 1
      AND i.status = 'active'
      AND ${buildSqlAssetExclusion("i")}
      AND NOT EXISTS (
        SELECT 1
        FROM user_feed_slots fs
        WHERE fs.user_id = ? AND fs.item_id = i.id
      )
    ORDER BY RANDOM()
    LIMIT 3
  `).bind(userId, userId).all<{ itemId: number; sourceId: number }>();

  let slot = 0;
  for (const row of fallbackItems.results ?? []) {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO user_feed_slots (user_id, date, slot_index, item_id, source_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(userId, targetDate, slot, row.itemId, row.sourceId).run();
    slot += 1;
  }
}

async function handlePostSources(request: Request, env: Env, ctx: ExecutionContext, userId: number) {
  let body: { name?: string; url?: string; type?: SourceType; rawText?: string; urls?: string[] };
  try {
    body = (await request.json()) as { name?: string; url?: string; type?: SourceType; rawText?: string; urls?: string[] };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.rawText === "string" || Array.isArray(body.urls)) {
    const { urls, totalCandidates, invalidTokens } = parseSourceUrls(body.rawText, body.urls);
    const existingRows = await env.DB
      .prepare(`
        SELECT s.id, s.name, s.url, s.type
        FROM user_sources us
        JOIN sources s ON s.id = us.source_id
        WHERE us.user_id = ?
      `)
      .bind(userId)
      .all<{ id: number; name: string; url: string; type: SourceType }>();
    const sourceByHost = new Map<string, { id: number; name: string; url: string; type: SourceType }>();
    for (const row of existingRows.results ?? []) {
      const host = extractSourceHost(row.url);
      if (host && !sourceByHost.has(host)) sourceByHost.set(host, row);
    }

    if (totalCandidates === 0) {
      return json({
        ok: true,
        added: 0,
        failed: 0,
        invalidCount: 0,
        duplicateCount: 0,
        totalCandidates: 0,
        validUniqueCount: 0,
        addedUrls: [],
        duplicateUrls: [],
        failedUrls: [],
        invalidTokens: [],
      });
    }

    const addedUrls: string[] = [];
    const duplicateUrls: string[] = [];
    const failedUrls: string[] = [];
    const touchedSourceIds = new Set<number>();
    let registeredOrReactivated = 0;
    for (const sourceUrl of urls) {
      const host = extractSourceHost(sourceUrl);
      const existingByHost = host && shouldDeduplicateByHost(sourceUrl) ? sourceByHost.get(host) : undefined;
      if (existingByHost) {
        duplicateUrls.push(sourceUrl);
        await upsertUserSourceActive(env, userId, existingByHost.id);
        touchedSourceIds.add(existingByHost.id);
        await seedItemForSource(existingByHost, env);
        ctx.waitUntil(hydrateSourceItems(existingByHost, env));
        registeredOrReactivated += 1;
        continue;
      }
      const sourceType = inferSourceType(sourceUrl);
      // Keep bulk insert fast/reliable: avoid per-URL network fetch during request.
      const sourceName = extractDomain(sourceUrl);
      try {
        const result = await env.DB
          .prepare("INSERT OR IGNORE INTO sources (name, url, type) VALUES (?, ?, ?)")
          .bind(sourceName, sourceUrl, sourceType)
          .run();
        if ((result.meta?.changes ?? 0) > 0) {
          addedUrls.push(sourceUrl);
          const inserted = await env.DB
            .prepare("SELECT id, name, url, type FROM sources WHERE url = ? LIMIT 1")
            .bind(sourceUrl)
            .first<{ id: number; name: string; url: string; type: SourceType }>();
          if (inserted) {
            await upsertUserSourceActive(env, userId, inserted.id);
            touchedSourceIds.add(inserted.id);
            await seedItemForSource(inserted, env);
            ctx.waitUntil(hydrateSourceItems(inserted, env));
            registeredOrReactivated += 1;
            const insertedHost = extractSourceHost(inserted.url);
            if (insertedHost && !sourceByHost.has(insertedHost)) sourceByHost.set(insertedHost, inserted);
          }
        } else {
          duplicateUrls.push(sourceUrl);
          const existing = await env.DB
            .prepare("SELECT id, name, url, type FROM sources WHERE url = ? LIMIT 1")
            .bind(sourceUrl)
            .first<{ id: number; name: string; url: string; type: SourceType }>();
          if (existing) {
            await upsertUserSourceActive(env, userId, existing.id);
            touchedSourceIds.add(existing.id);
            await seedItemForSource(existing, env);
            ctx.waitUntil(hydrateSourceItems(existing, env));
            registeredOrReactivated += 1;
          }
        }
      } catch {
        failedUrls.push(sourceUrl);
      }
    }

    if (registeredOrReactivated > 0) {
      const touchedIds = [...touchedSourceIds];
      ctx.waitUntil((async () => {
        await ensureItemsFromSources(env, undefined, userId);
        await backfillFeedsUntilDate(getTodayIso(), env, userId);
        // Keep added sources in "미분류" until user explicitly classifies.
        void touchedIds;
      })());
    }

    const added = addedUrls.length;
    const duplicateCount = duplicateUrls.length;
    const invalidCount = invalidTokens.length;
    const failed = invalidCount + failedUrls.length;

    return json({
      ok: true,
      added,
      registeredCount: registeredOrReactivated,
      failed,
      invalidCount,
      duplicateCount,
      totalCandidates,
      validUniqueCount: urls.length,
      addedUrls,
      sourceIds: [...touchedSourceIds],
      duplicateUrls,
      failedUrls,
      invalidTokens,
    }, { status: 201 });
  }

  if (!body.name || !body.url || !body.type) {
    return json({ error: "name, url, and type are required" }, { status: 400 });
  }
  if (!["rss", "blog"].includes(body.type)) {
    return json({ error: "type must be rss | blog" }, { status: 400 });
  }

  const incomingHost = extractSourceHost(body.url);
  if (incomingHost && shouldDeduplicateByHost(body.url)) {
    const existing = await env.DB
      .prepare(`
        SELECT s.id, s.name, s.url, s.type
        FROM user_sources us
        JOIN sources s ON s.id = us.source_id
        WHERE us.user_id = ?
      `)
      .bind(userId)
      .all<{ id: number; name: string; url: string; type: SourceType }>();
    const match = (existing.results ?? []).find((row) => extractSourceHost(row.url) === incomingHost);
    if (match) {
      await upsertUserSourceActive(env, userId, match.id);
      await seedItemForSource(match, env);
      ctx.waitUntil((async () => {
        await ensureItemsFromSources(env, undefined, userId);
        await backfillFeedsUntilDate(getTodayIso(), env, userId);
      })());
      ctx.waitUntil(hydrateSourceItems(match, env));
      return json({
        ok: true,
        duplicateByHost: true,
        sourceIds: [match.id],
        added: 0,
        registeredCount: 1,
        duplicateCount: 1,
        failed: 0,
        invalidCount: 0,
      }, { status: 201 });
    }
  }

  await env.DB.prepare("INSERT OR IGNORE INTO sources (name, url, type) VALUES (?, ?, ?)")
    .bind(body.name, body.url, body.type).run();
  const inserted = await env.DB
    .prepare("SELECT id, name, url, type FROM sources WHERE url = ? LIMIT 1")
    .bind(body.url)
    .first<{ id: number; name: string; url: string; type: SourceType }>();
  if (inserted) {
    await upsertUserSourceActive(env, userId, inserted.id);
    await seedItemForSource(inserted, env);
    ctx.waitUntil((async () => {
      await ensureItemsFromSources(env, undefined, userId);
      await backfillFeedsUntilDate(getTodayIso(), env, userId);
    })());
    ctx.waitUntil(hydrateSourceItems(inserted, env));
    return json({ ok: true, sourceIds: [inserted.id], added: 1, registeredCount: 1, duplicateCount: 0, failed: 0, invalidCount: 0 }, { status: 201 });
  }

  return json({ ok: true, sourceIds: [], added: 0, registeredCount: 0, duplicateCount: 0, failed: 0, invalidCount: 0 }, { status: 201 });
}

async function upsertUserSourceActive(env: Env, userId: number, sourceId: number) {
  await env.DB.prepare(`
    INSERT INTO user_sources (user_id, source_id, is_active, level)
    VALUES (?, ?, 1, 'focus')
    ON CONFLICT(user_id, source_id) DO UPDATE SET
      is_active = 1
  `).bind(userId, sourceId).run();
}

async function autoClassifySingleSourcesToLight(env: Env, userId: number, sourceIds: number[]) {
  const validSourceIds = sourceIds.filter(Number.isFinite);
  if (validSourceIds.length === 0) return;
  const uniqueSourceIds = [...new Set(validSourceIds)];
  const placeholders = uniqueSourceIds.map(() => "?").join(", ");
  const stats = await env.DB.prepare(`
    SELECT
      s.id AS sourceId,
      COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) AS splitItems
    FROM sources s
    LEFT JOIN items i ON i.source_id = s.id
    WHERE s.id IN (${placeholders})
    GROUP BY s.id
  `).bind(...uniqueSourceIds).all<{ sourceId: number; splitItems: number }>();

  const singleSourceIds = (stats.results ?? [])
    .filter((row) => Number(row.splitItems ?? 0) < 1)
    .map((row) => Number(row.sourceId))
    .filter(Number.isFinite);
  if (singleSourceIds.length === 0) return;

  await env.DB.batch(
    singleSourceIds.map((sourceId) =>
      env.DB.prepare(`
        UPDATE user_sources
        SET level = 'light'
        WHERE user_id = ?
          AND source_id = ?
          AND COALESCE(level, 'focus') = 'focus'
      `).bind(userId, sourceId)
    )
  );
}

async function triggerSourceRehydrateForPageUrl(pageUrl: string, env: Env, userId: number) {
  await ensureSourceRefreshTable(env);
  const source = await env.DB.prepare(`
    SELECT s.id, s.name, s.url, s.type
    FROM items i
    JOIN sources s ON s.id = i.source_id
    JOIN user_sources us ON us.user_id = ? AND us.source_id = s.id AND us.is_active = 1
    LEFT JOIN source_refresh_state rs ON rs.source_id = s.id
    WHERE i.url = ?
      AND (
        rs.last_refreshed_at IS NULL
        OR rs.last_refreshed_at <= datetime('now', '-${SOURCE_REFRESH_INTERVAL_MINUTES} minutes')
      )
    LIMIT 1
  `).bind(userId, pageUrl).first<{ id: number; name: string; url: string; type: SourceType }>();
  if (!source) return;

  await hydrateSourceItems(source, env);
  await env.DB.prepare(`
    INSERT INTO source_refresh_state (source_id, last_refreshed_at)
    VALUES (?, CURRENT_TIMESTAMP)
    ON CONFLICT(source_id) DO UPDATE SET last_refreshed_at = CURRENT_TIMESTAMP
  `).bind(source.id).run();
}

function parseSourceUrls(rawText?: string, urlsInput?: string[]) {
  const rawTokens = [
    ...(rawText ? rawText.split(/\s+/) : []),
    ...(Array.isArray(urlsInput) ? urlsInput : []),
  ]
    .map((v) => v.trim())
    .filter(Boolean);

  const unique = new Set<string>();
  const invalidTokens: string[] = [];
  for (const token of rawTokens) {
    const normalized = normalizeUrl(token);
    if (normalized) unique.add(normalized);
    else invalidTokens.push(token);
  }

  return {
    totalCandidates: rawTokens.length,
    invalidTokens,
    urls: [...unique],
  };
}

function normalizeUrl(input: string): string | null {
  const sanitized = input.trim().replace(/[),.;]+$/g, "");
  if (!sanitized) return null;
  const withScheme = /^[a-z]+:\/\//i.test(sanitized) ? sanitized : `https://${sanitized}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    stripTrackingQueryParams(parsed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractDomain(sourceUrl: string) {
  const host = extractSourceHost(sourceUrl);
  return host || "unknown";
}

function sanitizeTagValue(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_/]/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, 32);
}

function parseTagsInput(tagsRaw: unknown): string[] {
  if (!Array.isArray(tagsRaw)) return [];
  const set = new Set<string>();
  for (const raw of tagsRaw) {
    if (typeof raw !== "string") continue;
    const normalized = sanitizeTagValue(raw);
    if (!normalized) continue;
    set.add(normalized);
    if (set.size >= 12) break;
  }
  return [...set];
}

function extractSignalFromItem(title: string, sourceName: string, itemUrl: string) {
  const text = `${title} ${sourceName}`.toLowerCase();
  const tokens = text
    .split(/[^0-9a-zA-Z가-힣]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 24);
  const stop = new Set([
    "https", "http", "www", "com", "co", "kr", "net", "blog", "feed",
    "그리고", "에서", "으로", "하는", "있는", "this", "that", "with", "from",
  ]);
  const clean = tokens.filter((t) => !stop.has(t));
  const uniqueTags: string[] = [];
  const seen = new Set<string>();
  for (const t of clean) {
    if (seen.has(t)) continue;
    seen.add(t);
    uniqueTags.push(t);
    if (uniqueTags.length >= 6) break;
  }

  let topic = extractSourceHost(itemUrl);
  if (!topic) topic = sanitizeTagValue(sourceName);
  topic = topic.replace(/^www\./, "");

  return {
    tags: uniqueTags,
    topic: topic || "general",
  };
}

function extractSourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shouldDeduplicateByHost(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl);
    const path = parsed.pathname.replace(/\/+$/, "");
    // Root-like URLs can be deduped by host.
    if (!path || path === "/") return true;
    // Author/category/deep paths should be treated as distinct sources
    // (e.g. brunch writer pages, blog categories, newsroom sections).
    return false;
  } catch {
    return true;
  }
}

function isProtectedContentHost(value: string) {
  const host = value.includes("://") ? extractSourceHost(value) : value.toLowerCase().replace(/^www\./, "");
  return host === "longblack.co";
}

function inferSourceType(sourceUrl: string): SourceType {
  const lower = sourceUrl.toLowerCase();
  if (/(\/|\.)(rss|atom|feed)(\/|\.|$)/.test(lower) || lower.endsWith(".xml")) {
    return "rss";
  }
  return "blog";
}

function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || null;
}

function nextIsoDate(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

type CandidateQueryOptions = {
  userId: number;
  targetDate: string;
  limit: number;
  excludeItemIds: number[];
  excludeSourceIds: number[];
  requireNoMemo: boolean;
  distinctBySource: boolean;
  /** When true (default), skip items already assigned to any feed_slot on any date. */
  excludeAssigned?: boolean;
};

function buildInClause(column: string, values: number[]) {
  if (values.length === 0) return { sql: "", params: [] as number[] };
  return {
    sql: `AND ${column} NOT IN (${values.map(() => "?").join(", ")})`,
    params: values,
  };
}

function buildSqlAssetExclusion(alias: string) {
  return `
    ${alias}.url NOT LIKE '%/wp-content/%'
    AND ${alias}.url NOT LIKE '%/assets/%'
    AND ${alias}.url NOT LIKE '%/fonts/%'
    AND ${alias}.url NOT LIKE '%/_static/%'
    AND ${alias}.url NOT LIKE '%/static/%'
    AND ${alias}.url NOT LIKE '%.woff'
    AND ${alias}.url NOT LIKE '%.woff2'
    AND ${alias}.url NOT LIKE '%.ttf'
    AND ${alias}.url NOT LIKE '%.otf'
    AND ${alias}.url NOT LIKE '%.eot'
    AND ${alias}.url NOT LIKE '%.css'
    AND ${alias}.url NOT LIKE '%.js'
    AND ${alias}.url NOT LIKE '%.mjs'
    AND ${alias}.url NOT LIKE '%.map'
    AND ${alias}.url NOT LIKE '%.json'
    AND ${alias}.url NOT LIKE '%?%webfont%'
  `.replace(/\s+/g, " ").trim();
}

async function selectCandidateItemIds(env: Env, options: CandidateQueryOptions) {
  const { userId, targetDate } = options;
  const itemExclusion = buildInClause("i.id", options.excludeItemIds);
  const sourceExclusion = buildInClause("i.source_id", options.excludeSourceIds);
  const memoClause = options.requireNoMemo ? "AND (n.content IS NULL OR trim(n.content) = '')" : "";
  // Keep memoed items excluded and allow memo-less resurfacing after cooldown.
  // Blog-type (HTML-scraped) sources use a 30-day cooldown; RSS sources use 7 days.
  const assignedClause = options.excludeAssigned !== false
    ? `
      AND (n.content IS NULL OR trim(n.content) = '')
      AND NOT EXISTS (
        SELECT 1
        FROM user_feed_slots fs_chk
        WHERE fs_chk.item_id = i.id
          AND fs_chk.user_id = ?
          AND fs_chk.date >= date(?, CASE WHEN s.type = 'blog' THEN '-30 day' ELSE '-${RESURFACE_COOLDOWN_DAYS} day' END)
      )
    `
    : "";
  const limit = Math.max(0, options.limit);
  if (limit === 0) return [] as number[];

  const activeSourceCountRow = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM user_sources WHERE user_id = ? AND is_active = 1
  `).bind(userId).first<{ count?: number }>();
  const shouldApplyPreference = Number(activeSourceCountRow?.count ?? 0) >= PREFERENCE_APPLY_SOURCE_MIN;

  const sourcePenalty = new Map<number, number>();
  const tagPenalty = new Map<string, number>();
  const topicPenalty = new Map<string, number>();
  if (shouldApplyPreference) {
    const sourceRows = await env.DB.prepare(`
      SELECT source_id, score FROM user_source_penalties WHERE user_id = ?
    `).bind(userId).all<{ source_id: number; score: number }>();
    for (const row of sourceRows.results ?? []) sourcePenalty.set(Number(row.source_id), Number(row.score ?? 0));

    const tagRows = await env.DB.prepare(`
      SELECT tag, score FROM user_tag_penalties WHERE user_id = ?
    `).bind(userId).all<{ tag: string; score: number }>();
    for (const row of tagRows.results ?? []) tagPenalty.set(String(row.tag), Number(row.score ?? 0));

    const topicRows = await env.DB.prepare(`
      SELECT topic, score FROM user_topic_penalties WHERE user_id = ?
    `).bind(userId).all<{ topic: string; score: number }>();
    for (const row of topicRows.results ?? []) topicPenalty.set(String(row.topic), Number(row.score ?? 0));
  }

  const effectiveQueryLimit = Math.min(240, Math.max(limit * 8, 24));
  const levelWeight = (level?: string) => {
    if (level === "core") return 3;
    if (level === "light") return 1;
    return 2;
  };
  // Scoring: lower score = higher priority.
  // recencyRank 0 = newest item, recencyRank n-1 = oldest item (within candidate set).
  // Recency contributes up to 500_000 penalty for the oldest item, giving a strong
  // but not absolute recency preference (randomness still mixes things up).
  const scoreCandidate = (row: { id: number; source_id: number; title: string; url: string; level: string }, recencyRank: number, totalCandidates: number) => {
    const recencyPenalty = totalCandidates > 1 ? (recencyRank / (totalCandidates - 1)) * 500_000 : 0;
    const randomPart = (Math.random() * 500_000) / levelWeight(row.level);
    const base = recencyPenalty + randomPart;
    if (!shouldApplyPreference) return base;
    const signals = extractSignalFromItem(row.title ?? "", "", row.url ?? "");
    const sourceP = sourcePenalty.get(Number(row.source_id)) ?? 0;
    const tagP = signals.tags.reduce((sum, t) => sum + (tagPenalty.get(t) ?? 0), 0);
    const topicP = topicPenalty.get(signals.topic) ?? 0;
    // Slight downrank only
    return base + sourceP * 45 + tagP * 22 + topicP * 28;
  };

  if (options.distinctBySource) {
    const rows = await env.DB.prepare(`
      WITH candidate AS (
        SELECT
          i.id,
          i.source_id,
          i.title,
          i.url,
          COALESCE(us.level, 'focus') AS level,
          ROW_NUMBER() OVER (
            PARTITION BY i.source_id
            ORDER BY i.id DESC
          ) AS source_rank
        FROM items i
        JOIN user_sources us ON us.user_id = ? AND us.source_id = i.source_id
        JOIN sources s ON s.id = i.source_id
        LEFT JOIN user_notes n ON n.item_id = i.id AND n.user_id = ?
        WHERE i.status = 'active'
          AND us.is_active = 1
          AND NOT EXISTS (
            SELECT 1
            FROM user_hidden_items uhi
            WHERE uhi.user_id = ?
              AND uhi.date = ?
              AND uhi.item_id = i.id
          )
          AND ${buildSqlAssetExclusion("i")}
          AND RTRIM(i.url, '/') != RTRIM(s.url, '/')
          ${memoClause}
          ${assignedClause}
          ${itemExclusion.sql}
          ${sourceExclusion.sql}
      )
      SELECT id
           , source_id AS source_id
           , title
           , url
           , level
      FROM candidate
      WHERE source_rank = 1
      ORDER BY id DESC
      LIMIT ?
    `).bind(
      userId,
      userId,
      userId,
      targetDate,
      ...(options.excludeAssigned !== false ? [userId, targetDate] : []),
      ...itemExclusion.params,
      ...sourceExclusion.params,
      effectiveQueryLimit,
    ).all();

    const candidates = ((rows.results ?? []) as Record<string, unknown>[])
      .map((row) => ({
        id: Number(row.id),
        source_id: Number(row.source_id),
        title: String(row.title ?? ""),
        url: String(row.url ?? ""),
        level: String(row.level ?? "focus"),
      }))
      .filter((row) => Number.isFinite(row.id))
      // Sort newest-first so recencyRank index maps correctly to item age.
      .sort((a, b) => b.id - a.id);
    const ranked = candidates
      .map((row, idx) => ({ ...row, score: scoreCandidate(row, idx, candidates.length) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((row) => row.id);
    return ranked;
  }

  const rows = await env.DB.prepare(`
    SELECT i.id, i.source_id, i.title, i.url, COALESCE(us.level, 'focus') AS level
    FROM items i
    JOIN user_sources us ON us.user_id = ? AND us.source_id = i.source_id
    JOIN sources s ON s.id = i.source_id
    LEFT JOIN user_notes n ON n.item_id = i.id AND n.user_id = ?
    WHERE i.status = 'active'
      AND us.is_active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM user_hidden_items uhi
        WHERE uhi.user_id = ?
          AND uhi.date = ?
          AND uhi.item_id = i.id
      )
      AND ${buildSqlAssetExclusion("i")}
      AND RTRIM(i.url, '/') != RTRIM(s.url, '/')
      ${memoClause}
      ${assignedClause}
      ${itemExclusion.sql}
      ${sourceExclusion.sql}
    ORDER BY i.id DESC
    LIMIT ?
  `).bind(
    userId,
    userId,
    userId,
    targetDate,
    ...(options.excludeAssigned !== false ? [userId, targetDate] : []),
    ...itemExclusion.params,
    ...sourceExclusion.params,
    effectiveQueryLimit,
  ).all();

  const candidates2 = ((rows.results ?? []) as Record<string, unknown>[])
    .map((row) => ({
      id: Number(row.id),
      source_id: Number(row.source_id),
      title: String(row.title ?? ""),
      url: String(row.url ?? ""),
      level: String(row.level ?? "focus"),
    }))
    .filter((row) => Number.isFinite(row.id))
    .sort((a, b) => b.id - a.id);
  const ranked = candidates2
    .map((row, idx) => ({ ...row, score: scoreCandidate(row, idx, candidates2.length) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((row) => row.id);
  return ranked;
}

async function pruneDateAssetLikeSlots(targetDate: string, env: Env, userId: number) {
  await env.DB.prepare(`
    DELETE FROM user_feed_slots
    WHERE user_id = ?
      AND date = ?
      AND EXISTS (
        SELECT 1
        FROM items i
        WHERE i.id = user_feed_slots.item_id
          AND NOT (${buildSqlAssetExclusion("i")})
      )
  `).bind(userId, targetDate).run();
}

/** Batch-fetch item metadata for a list of item IDs. */
async function fetchItemMetaForItems(
  env: Env,
  itemIds: number[],
): Promise<Map<number, { sourceId: number; title: string; url: string }>> {
  if (itemIds.length === 0) return new Map();
  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT id, source_id, title, url FROM items WHERE id IN (${placeholders})`
  ).bind(...itemIds).all<{ id: number; source_id: number; title: string; url: string }>();
  return new Map((rows.results ?? []).map((r) => [
    Number(r.id),
    {
      sourceId: Number(r.source_id),
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
    },
  ]));
}

async function fillDateIfNeeded(targetDate: string, env: Env, userId: number) {
  // Keep only slots backed by currently active user sources for this user/date.
  await env.DB.prepare(`
    DELETE FROM user_feed_slots
    WHERE user_id = ? AND date = ?
      AND NOT EXISTS (
        SELECT 1
        FROM user_sources us
        WHERE us.user_id = user_feed_slots.user_id
          AND us.source_id = user_feed_slots.source_id
          AND us.is_active = 1
      )
  `).bind(userId, targetDate).run();
  await env.DB.prepare(`
    DELETE FROM user_feed_slots
    WHERE user_id = ? AND date = ?
      AND EXISTS (
        SELECT 1
        FROM user_hidden_items uhi
        WHERE uhi.user_id = user_feed_slots.user_id
          AND uhi.date = user_feed_slots.date
          AND uhi.item_id = user_feed_slots.item_id
      )
  `).bind(userId, targetDate).run();
  await pruneDateItemsDuplicatedAcrossOtherDates(env, userId, targetDate);
  await pruneDateContentDuplicatesByKey(env, userId, targetDate);

  const existing = await env.DB.prepare(`
    SELECT slot_index, item_id, source_id
    FROM user_feed_slots
    WHERE user_id = ? AND date = ?
    ORDER BY slot_index
    LIMIT 3
  `).bind(userId, targetDate).all();
  const currentRows = (existing.results ?? []) as Record<string, unknown>[];
  const currentIds = currentRows.map((row) => Number(row.item_id)).filter(Number.isFinite);
  const currentSourceIds = currentRows.map((row) => Number(row.source_id)).filter(Number.isFinite);
  const seenDedupKeys = await collectSeenContentDedupKeys(env, userId, targetDate, currentIds);
  const filledSlots = new Set(currentRows.map((row) => Number(row.slot_index)).filter(Number.isFinite));
  let missingSlots = [0, 1, 2].filter((slot) => !filledSlots.has(slot));
  if (missingSlots.length <= 0) return;

  const fatigueRows = await env.DB.prepare(`
    SELECT DISTINCT source_id
    FROM user_feed_slots
    WHERE user_id = ?
      AND date < ?
      AND date >= date(?, '-3 day')
  `).bind(userId, targetDate, targetDate).all();
  const fatiguedSourceIds = ((fatigueRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.source_id))
    .filter(Number.isFinite);

  /**
   * Apply one fill pass: batch-fetch source_ids, batch-insert slots, track state in memory.
   * Eliminates the per-item SELECT + per-item INSERT pattern (was N+1 × 3 passes).
   *
   * NOTE: cursor only advances when a valid, non-dedup candidate is actually assigned.
   * Skipped candidates (missing meta, dedup collision) do NOT consume a slot index.
   */
  async function applyPass(candidates: number[]): Promise<void> {
    if (candidates.length === 0 || missingSlots.length === 0) return;
    const metaMap = await fetchItemMetaForItems(env, candidates);
    const assignments: Array<[slot: number, itemId: number, sourceId: number]> = [];
    let cursor = 0;
    for (const id of candidates) {
      if (cursor >= missingSlots.length) break;
      const meta = metaMap.get(id);
      if (!meta) continue;
      const dedupKey = buildContentDedupKey(meta.sourceId, meta.title, meta.url);
      if (seenDedupKeys.has(dedupKey)) continue;
      const slot = missingSlots[cursor++];
      assignments.push([slot, id, meta.sourceId]);
      filledSlots.add(slot);
      seenDedupKeys.add(dedupKey);
      currentIds.push(id);
      currentSourceIds.push(meta.sourceId);
    }
    if (assignments.length > 0) {
      await env.DB.batch(
        assignments.map(([slot, itemId, sourceId]) =>
          env.DB.prepare(
            `INSERT OR REPLACE INTO user_feed_slots (user_id, date, slot_index, item_id, source_id) VALUES (?, ?, ?, ?, ?)`
          ).bind(userId, targetDate, slot, itemId, sourceId)
        )
      );
    }
    missingSlots = [0, 1, 2].filter((slot) => !filledSlots.has(slot));
  }

  // Pass 1: diverse sources, avoid recently seen sources
  const diverse = await selectCandidateItemIds(env, {
    userId,
    targetDate,
    limit: missingSlots.length,
    excludeItemIds: currentIds,
    excludeSourceIds: [...new Set([...currentSourceIds, ...fatiguedSourceIds])],
    requireNoMemo: true,
    distinctBySource: true,
  });
  await applyPass(diverse);
  if (missingSlots.length <= 0) return;

  // Pass 2: relax source fatigue, still distinct sources
  const fallback = await selectCandidateItemIds(env, {
    userId,
    targetDate,
    limit: missingSlots.length,
    excludeItemIds: currentIds,
    excludeSourceIds: currentSourceIds,
    requireNoMemo: true,
    distinctBySource: true,
  });
  await applyPass(fallback);
  if (missingSlots.length <= 0) return;

  // Pass 3: relax memo requirement, any source, still respect assignment cooldown
  const relaxed = await selectCandidateItemIds(env, {
    userId,
    targetDate,
    limit: missingSlots.length,
    excludeItemIds: currentIds,
    excludeSourceIds: [],
    requireNoMemo: false,
    distinctBySource: false,
  });
  await applyPass(relaxed);
  if (missingSlots.length <= 0) return;

  // Pass 4: absolute last resort — ignore cooldown entirely.
  // Guarantees 3 items even for accounts with very few sources or items.
  const absolute = await selectCandidateItemIds(env, {
    userId,
    targetDate,
    limit: missingSlots.length,
    excludeItemIds: currentIds,
    excludeSourceIds: [],
    requireNoMemo: false,
    distinctBySource: false,
    excludeAssigned: false,
  });
  await applyPass(absolute);
}

async function pruneDateItemsDuplicatedAcrossOtherDates(env: Env, userId: number, targetDate: string) {
  await env.DB.prepare(`
    DELETE FROM user_feed_slots
    WHERE user_id = ? AND date = ?
      AND EXISTS (
        SELECT 1
        FROM user_feed_slots fs2
        WHERE fs2.user_id = user_feed_slots.user_id
          AND fs2.item_id = user_feed_slots.item_id
          AND fs2.date <> user_feed_slots.date
      )
  `).bind(userId, targetDate).run();
}

async function pruneDateContentDuplicatesByKey(env: Env, userId: number, targetDate: string) {
  const otherRows = await env.DB.prepare(`
    SELECT i.source_id AS sourceId, i.title AS title, i.url AS url
    FROM user_feed_slots fs
    JOIN items i ON i.id = fs.item_id
    WHERE fs.user_id = ? AND fs.date <> ?
  `).bind(userId, targetDate).all<{ sourceId: number; title: string; url: string }>();
  const seen = new Set<string>();
  for (const row of otherRows.results ?? []) {
    seen.add(buildContentDedupKey(Number(row.sourceId), String(row.title ?? ""), String(row.url ?? "")));
  }

  const targetRows = await env.DB.prepare(`
    SELECT fs.slot_index AS slotIndex, i.source_id AS sourceId, i.title AS title, i.url AS url
    FROM user_feed_slots fs
    JOIN items i ON i.id = fs.item_id
    WHERE fs.user_id = ? AND fs.date = ?
    ORDER BY fs.slot_index ASC
  `).bind(userId, targetDate).all<{ slotIndex: number; sourceId: number; title: string; url: string }>();

  const deleteSlots: number[] = [];
  for (const row of targetRows.results ?? []) {
    const key = buildContentDedupKey(Number(row.sourceId), String(row.title ?? ""), String(row.url ?? ""));
    if (seen.has(key)) {
      deleteSlots.push(Number(row.slotIndex));
      continue;
    }
    seen.add(key);
  }

  if (deleteSlots.length === 0) return;
  await env.DB.batch(
    deleteSlots.map((slot) =>
      env.DB.prepare(`
        DELETE FROM user_feed_slots
        WHERE user_id = ? AND date = ? AND slot_index = ?
      `).bind(userId, targetDate, slot)
    )
  );
}

async function backfillFeedsUntilDate(targetDate: string, env: Env, userId: number) {
  const today = new Date().toISOString().slice(0, 10);
  const maxDate = targetDate > today ? today : targetDate;
  await fillDateIfNeeded(maxDate, env, userId);
}

async function ensureSourceRefreshTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS source_refresh_state (
      source_id INTEGER PRIMARY KEY,
      last_refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `).run();
}

/** Weekly cron: re-crawl every active source with cache bypass to pick up new content. */
async function refreshAllSourcesGlobal(env: Env) {
  await ensureSourceRefreshTable(env);
  const sources = await env.DB.prepare(`
    SELECT DISTINCT s.id, s.name, s.url, s.type
    FROM sources s
    JOIN user_sources us ON us.source_id = s.id
    WHERE us.is_active = 1
    ORDER BY s.id ASC
  `).all<{ id: number; name: string; url: string; type: SourceType }>();

  for (const source of sources.results ?? []) {
    try {
      await hydrateSourceItems(source, env, true /* fresh — bypass cache */);
    } catch { /* best-effort: skip erroring sources */ } finally {
      await env.DB.prepare(`
        INSERT INTO source_refresh_state (source_id, last_refreshed_at)
        VALUES (?, CURRENT_TIMESTAMP)
        ON CONFLICT(source_id) DO UPDATE SET last_refreshed_at = CURRENT_TIMESTAMP
      `).bind(source.id).run();
    }
  }
}

async function refreshStaleSourcesInBackground(env: Env, userId: number) {
  await ensureSourceRefreshTable(env);
  const staleSources = await env.DB.prepare(`
    SELECT s.id, s.name, s.url, s.type
    FROM user_sources us
    JOIN sources s ON s.id = us.source_id
    LEFT JOIN source_refresh_state rs ON rs.source_id = s.id
    WHERE us.user_id = ? AND us.is_active = 1
      AND (
        rs.last_refreshed_at IS NULL
        OR rs.last_refreshed_at <= datetime('now', '-${SOURCE_REFRESH_INTERVAL_MINUTES} minutes')
      )
    ORDER BY COALESCE(rs.last_refreshed_at, '1970-01-01 00:00:00') ASC
    LIMIT ?
  `).bind(userId, SOURCE_REFRESH_BATCH_SIZE).all<{ id: number; name: string; url: string; type: SourceType }>();

  for (const source of staleSources.results ?? []) {
    try {
      await hydrateSourceItems(source, env);
    } finally {
      await env.DB.prepare(`
        INSERT INTO source_refresh_state (source_id, last_refreshed_at)
        VALUES (?, CURRENT_TIMESTAMP)
        ON CONFLICT(source_id) DO UPDATE SET last_refreshed_at = CURRENT_TIMESTAMP
      `).bind(source.id).run();
    }
  }
}

async function cleanupDemoData(env: Env) {
  await env.DB.prepare("DELETE FROM items WHERE url LIKE 'https://memoryfeed.local/%'").run();
  await env.DB.prepare("DELETE FROM sources WHERE url LIKE 'https://memoryfeed.local/%'").run();
}

async function ensureItemsFromSources(env: Env, ctx: ExecutionContext | undefined, userId: number) {
  const rows = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.url,
      s.type,
      COUNT(i.id) AS itemCount,
      SUM(CASE WHEN RTRIM(i.url, '/') = RTRIM(s.url, '/') THEN 1 ELSE 0 END) AS rootUrlCount,
      SUM(CASE
        WHEN i.summary IS NULL OR trim(i.summary) = ''
          THEN CASE WHEN lower(trim(COALESCE(i.title, ''))) = lower(trim(COALESCE(s.name, ''))) THEN 1 ELSE 0 END
        ELSE 0
      END) AS weakTitleCount
    FROM user_sources us
    JOIN sources s ON s.id = us.source_id
    LEFT JOIN items i ON i.source_id = s.id
    WHERE us.user_id = ? AND us.is_active = 1
    GROUP BY s.id
  `).bind(userId).all();

  for (const row of (rows.results ?? []) as Record<string, unknown>[]) {
    const source = {
      id: Number(row.id),
      name: String(row.name ?? ""),
      url: String(row.url ?? ""),
      type: (row.type === "rss" ? "rss" : "blog") as SourceType,
    };
    const itemCount = Number(row.itemCount ?? 0);
    const rootUrlCount = Number(row.rootUrlCount ?? 0);
    const weakTitleCount = Number(row.weakTitleCount ?? 0);
    if (itemCount === 0) {
      // Fast DB-only seed — keep inline so the slot-filling pass has something to work with.
      await seedItemForSource(source, env);
      continue;
    }

    // If this source only has homepage placeholders, re-hydrate via HTTP.
    // Run in background so the response is never blocked by an external fetch.
    const onlyRootLikeItems =
      itemCount > 0 && (rootUrlCount >= itemCount || weakTitleCount >= itemCount);
    if (onlyRootLikeItems) {
      if (ctx) ctx.waitUntil(hydrateSourceItems(source, env));
      else await hydrateSourceItems(source, env);
    }
  }
}

async function seedItemForSource(
  source: { id: number; name: string; url: string; type: SourceType },
  env: Env,
) {
  const normalizedUrl = normalizeUrl(source.url);
  if (!normalizedUrl) return;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
    VALUES (?, ?, ?, NULL, NULL, 'active', NULL)
  `).bind(
    source.id,
    source.name || extractDomain(normalizedUrl),
    normalizedUrl,
  ).run();
}

async function hydrateSourceItems(
  source: { id: number; name: string; url: string; type: SourceType },
  env: Env,
  fresh = false,
) {
  const inserted = await ingestItemsForSource(source, env, fresh);
  if (inserted <= 0) return;

  await env.DB.prepare(`
    DELETE FROM items
    WHERE source_id = ?
      AND RTRIM(url, '/') = RTRIM(?, '/')
      AND NOT EXISTS (
        SELECT 1
        FROM user_notes n
        WHERE n.item_id = items.id
          AND trim(n.content) != ''
      )
  `).bind(source.id, source.url).run();
}

async function ingestItemsForSource(
  source: { id: number; name: string; url: string; type: SourceType },
  env: Env,
  fresh = false,
) {
  const entries = await collectSourceEntries(source, fresh);
  if (entries.length === 0) return 0;

  let inserted = 0;
  const limitedEntries = entries.slice(0, ENTRY_LIMIT_PER_SOURCE);
  for (let idx = 0; idx < limitedEntries.length; idx += 1) {
    const entry = limitedEntries[idx];
    const shouldStrictValidate = idx < ENTRY_VALIDATE_LIMIT_PER_SOURCE;
    // True when the feed provided no title — we only have a URL-slug guess.
    // These entries need HTML enrichment even if summary/thumbnail exist.
    const titleIsUrlDerived = !normalizeDisplayText(entry.title || "");
    let prefetchedHtml: string | null = null;
    let resolvedUrl = entry.url;
    // Validate landing for: known risky URL patterns, AND for any entry whose
    // title we will have to guess from the URL slug (likely misses real title).
    const shouldValidateLanding = shouldStrictValidate && (shouldValidateEntryLanding(entry.url, source.url) || titleIsUrlDerived);
    if (shouldValidateLanding) {
      const validated = await resolveValidatedLanding(entry.url, source.url);
      if (!validated) {
        if (!isProtectedContentHost(source.url)) continue;
      } else {
        resolvedUrl = validated.url;
        prefetchedHtml = validated.html;
      }
    }

    let resolvedTitle = normalizeDisplayText(entry.title || deriveTitleFromUrl(resolvedUrl) || source.name);
    let resolvedSummary = entry.summary ? normalizeDisplayText(entry.summary) : null;
    let resolvedThumbnail = entry.thumbnailUrl ?? null;

    if (isWeakEntryTitle(resolvedTitle, source.name) || titleIsUrlDerived || !isUsableSummary(resolvedSummary ?? "") || !resolvedThumbnail) {
      const html = prefetchedHtml ?? await fetchSourceText(resolvedUrl, "text/html,application/xhtml+xml");
      // If the page is completely unreachable (404, blocked, etc.) and we have no
      // metadata at all from the feed, there is nothing useful to show. Skip it
      // unless the source is a protected-content host where fetching always fails.
      if (!html && !isUsableSummary(resolvedSummary ?? "") && !resolvedThumbnail) {
        if (!isProtectedContentHost(source.url)) continue;
      }
      if (html) {
        // Always try to get a better title from HTML when we have it —
        // not just when the current title is "weak". This fixes cases where
        // deriveTitleFromUrl produced a URL slug (e.g. "newoffice") that passes
        // isWeakEntryTitle but is still worse than the real page title.
        const htmlTitle = normalizeDisplayText((extractHtmlTitle(html) ?? "").replace(/\|\s*Substack.*$/i, "").trim());
        const metaTitle = normalizeDisplayText(extractMetaTitle(html) ?? "");
        if (htmlTitle && !isWeakEntryTitle(htmlTitle, source.name)) {
          resolvedTitle = htmlTitle;
        } else if (metaTitle && !isWeakEntryTitle(metaTitle, source.name)) {
          resolvedTitle = metaTitle;
        }
        if (!resolvedSummary || !isUsableSummary(resolvedSummary)) {
          const metaSummary = normalizeDisplayText(extractMetaDescription(html) ?? "");
          if (isUsableSummary(metaSummary)) {
            resolvedSummary = metaSummary;
          }
        }
        if (!resolvedThumbnail) {
          const metaImage = extractMetaImage(html, resolvedUrl);
          if (metaImage) {
            resolvedThumbnail = metaImage;
          } else {
            const inlineImage = extractFirstContentImage(html, resolvedUrl);
            if (inlineImage) resolvedThumbnail = inlineImage;
          }
        }
      }
    }
    if (isWeakEntryTitle(resolvedTitle, source.name)) {
      resolvedTitle = buildFallbackTitleFromSummary(resolvedSummary ?? "", source.name);
      if (isWeakEntryTitle(resolvedTitle, source.name)) {
        const pathFallback = derivePathTitleFromUrl(resolvedUrl);
        if (pathFallback) resolvedTitle = pathFallback;
      }
    }

    if ((!resolvedSummary || !isUsableSummary(resolvedSummary)) && isProtectedContentHost(source.url)) {
      resolvedSummary = "원문 보호 정책으로 요약을 불러오지 못했어요.";
    }

    const result = await env.DB.prepare(`
      INSERT INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
      VALUES (?, ?, ?, ?, ?, 'active', NULL)
      ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN items.title IS NULL OR trim(items.title) = '' THEN excluded.title
          WHEN lower(trim(items.title)) = lower(trim(?)) THEN excluded.title
          WHEN items.title LIKE 'http://%' OR items.title LIKE 'https://%' THEN excluded.title
          WHEN items.title LIKE '%&#%' THEN excluded.title
          WHEN items.title LIKE '%]]>%' THEN excluded.title
          WHEN length(trim(items.title)) <= 8 AND trim(items.title) NOT GLOB '*[^0-9]*' THEN excluded.title
          WHEN items.title LIKE '%!%%' ESCAPE '!' THEN excluded.title
          -- Single-word all-lowercase title with no spaces (≤20 chars) is almost
          -- certainly a URL slug stored from a previous deriveTitleFromUrl pass.
          -- Allow the new enriched title to overwrite it.
          WHEN items.title NOT GLOB '* *'
            AND items.title GLOB '*[a-z]*'
            AND items.title NOT GLOB '*[A-Z]*'
            AND items.title NOT GLOB '*[0-9]*'
            AND length(trim(items.title)) BETWEEN 3 AND 20 THEN excluded.title
          ELSE items.title
        END,
        summary = CASE
          WHEN items.summary IS NULL OR trim(items.summary) = '' THEN excluded.summary
          WHEN items.summary LIKE '%&#%' THEN excluded.summary
          WHEN items.summary LIKE '%]]>%' THEN excluded.summary
          WHEN trim(items.summary) = '*' THEN excluded.summary
          WHEN trim(items.summary) = '-' THEN excluded.summary
          WHEN items.summary LIKE '%<%>%' THEN excluded.summary
          WHEN items.summary LIKE '%Discussion | Link%' THEN excluded.summary
          WHEN items.summary LIKE '%utm_campaign=%' THEN excluded.summary
          ELSE items.summary
        END,
        thumbnail_url = CASE
          WHEN excluded.thumbnail_url IS NULL OR trim(excluded.thumbnail_url) = '' THEN items.thumbnail_url
          WHEN items.thumbnail_url IS NULL OR trim(items.thumbnail_url) = '' THEN excluded.thumbnail_url
          WHEN lower(items.thumbnail_url) LIKE '%/favicon.ico%' AND lower(excluded.thumbnail_url) NOT LIKE '%/favicon.ico%' THEN excluded.thumbnail_url
          ELSE items.thumbnail_url
        END
    `).bind(
      source.id,
      resolvedTitle,
      resolvedUrl,
      resolvedSummary,
      resolvedThumbnail,
      source.name,
    ).run();
    inserted += Number(result.meta?.changes ?? 0);
  }
  return inserted;
}

async function fetchSourceText(targetUrl: string, accept = "text/html,application/xhtml+xml,application/xml,text/xml", fresh = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(targetUrl, {
      headers: buildCrawlerHeaders(accept),
      signal: controller.signal,
      cf: fresh ? { cacheEverything: false } : { cacheEverything: true, cacheTtl: 60 * 30 },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtmlWithMeta(targetUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(targetUrl, {
      headers: buildCrawlerHeaders("text/html,application/xhtml+xml"),
      signal: controller.signal,
      cf: { cacheEverything: true, cacheTtl: 60 * 15 },
      redirect: "follow",
    });
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const body = contentType.includes("text/html") ? await res.text() : "";
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || targetUrl,
      contentType,
      body,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractAlternateHreflangUrl(html: string, pageUrl: string, langPrefix: string) {
  const re = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  const tags = html.match(re) || [];
  for (const tag of tags) {
    const hreflang = (getAttr(tag, "hreflang") || "").toLowerCase();
    if (!hreflang.startsWith(langPrefix)) continue;
    const href = getAttr(tag, "href");
    if (!href) continue;
    const normalized = normalizeEntryUrl(href, pageUrl);
    if (normalized) return normalized;
  }
  return null;
}

function isLikelyErrorPage(html: string, resolvedUrl: string) {
  const lowerUrl = resolvedUrl.toLowerCase();
  if (/(^|\/)(404|not-found|not_found|error)(\/|$)/.test(lowerUrl)) return true;
  const head = html.slice(0, 1500).toLowerCase();
  // Title-tag 404 patterns (catches "<title>404 Not Found</title>" etc.)
  const titleMatch = head.match(/<title[^>]*>([^<]{0,120})<\/title>/);
  if (titleMatch) {
    const t = titleMatch[1];
    if (/\b404\b/.test(t) || /not.?found/i.test(t) || /page.?not.?found/i.test(t)) return true;
  }
  return (
    head.includes("page not found") ||
    head.includes(">404<") ||
    head.includes("404 not found") ||
    head.includes("not found -") ||
    head.includes("- not found") ||
    head.includes("이 페이지는 존재하지") ||
    head.includes("찾을 수 없습니다") ||
    head.includes("존재하지 않는") ||
    head.includes("페이지를 찾을 수") ||
    head.includes("삭제된 게시물") ||
    head.includes("삭제된 페이지")
  );
}

function looksEnglishLanding(resolvedUrl: string, html: string) {
  const lowerUrl = resolvedUrl.toLowerCase();
  if (lowerUrl.includes("/en/") || lowerUrl.endsWith("-en") || lowerUrl.includes("lang=en")) return true;
  const htmlLang = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
  return htmlLang.startsWith("en");
}

async function resolveValidatedLanding(entryUrl: string, sourceUrl: string): Promise<{ url: string; html: string } | null> {
  const normalized = normalizeEntryUrl(entryUrl, sourceUrl);
  if (!normalized) return null;

  const candidates = new Set<string>([normalized]);
  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.includes("/en/")) {
      const koPath = parsed.pathname.replace("/en/", "/ko/");
      if (koPath !== parsed.pathname) {
        const alt = new URL(parsed.toString());
        alt.pathname = koPath;
        candidates.add(alt.toString());
      }
    }
    if (parsed.searchParams.get("lang") === "en") {
      const alt = new URL(parsed.toString());
      alt.searchParams.set("lang", "ko");
      candidates.add(alt.toString());
    }
  } catch {
    // no-op
  }

  let best: { url: string; html: string } | null = null;
  for (const candidate of candidates) {
    const fetched = await fetchHtmlWithMeta(candidate);
    if (!fetched || !fetched.ok || fetched.status >= 400) continue;
    if (!fetched.contentType.includes("text/html")) continue;
    if (!fetched.body || isLikelyErrorPage(fetched.body, fetched.url)) continue;

    const koAlt = extractAlternateHreflangUrl(fetched.body, fetched.url, "ko");
    if (koAlt && koAlt !== fetched.url) {
      const koFetched = await fetchHtmlWithMeta(koAlt);
      if (
        koFetched &&
        koFetched.ok &&
        koFetched.status < 400 &&
        koFetched.contentType.includes("text/html") &&
        koFetched.body &&
        !isLikelyErrorPage(koFetched.body, koFetched.url)
      ) {
        return { url: koFetched.url, html: koFetched.body };
      }
    }

    if (!best) best = { url: fetched.url, html: fetched.body };
    if (!looksEnglishLanding(fetched.url, fetched.body)) {
      return { url: fetched.url, html: fetched.body };
    }
  }
  return best;
}

function shouldValidateEntryLanding(entryUrl: string, sourceUrl: string) {
  const normalized = normalizeEntryUrl(entryUrl, sourceUrl);
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  if (lower.includes("/en/") || lower.includes("lang=en") || /(?:-|_)en(?:$|[/?#])/.test(lower)) return true;
  if (lower.includes("404") || lower.includes("not-found") || lower.includes("not_found")) return true;
  if (lower.includes("toss.im")) return true;
  return false;
}

async function cleanupInvalidItemsForUser(env: Env, userId: number) {
  // NOTE:
  // Aggressive runtime cleanup was causing feed instability (2 cards / slow responses)
  // when validation endpoints intermittently failed. Keep as no-op for stability-first.
  void env;
  void userId;
}

async function ensureThumbnailsForShownItems(rows: Record<string, unknown>[], env: Env) {
  const itemIds = [...new Set(
    rows.map((row) => Number(row.id)).filter(Number.isFinite)
  )];
  if (itemIds.length === 0) return;

  const placeholders = itemIds.map(() => "?").join(", ");
  const targets = await env.DB.prepare(`
    SELECT i.id AS itemId, i.url AS itemUrl, i.thumbnail_url AS thumbnailUrl
    FROM items i
    WHERE i.id IN (${placeholders})
  `).bind(...itemIds).all<{ itemId: number; itemUrl: string; thumbnailUrl?: string | null }>();

  for (const target of targets.results ?? []) {
    const existing = (target.thumbnailUrl ?? "").trim();
    if (existing && !existing.toLowerCase().includes("/favicon.ico")) continue;
    const html = await fetchSourceText(target.itemUrl, "text/html,application/xhtml+xml");
    if (!html) continue;
    const metaImage = extractMetaImage(html, target.itemUrl);
    const inlineImage = metaImage ? null : extractFirstContentImage(html, target.itemUrl);
    const selected = metaImage || inlineImage;
    if (!selected) continue;
    await env.DB.prepare(`
      UPDATE items
      SET thumbnail_url = ?
      WHERE id = ?
    `).bind(selected, target.itemId).run();
  }
}

type SourceEntry = { title: string; url: string; summary?: string; thumbnailUrl?: string };

async function collectSourceEntries(source: { url: string; type: SourceType }, fresh = false): Promise<SourceEntry[]> {
  if (source.type === "rss") {
    const text = await fetchSourceText(source.url, "application/rss+xml,application/atom+xml,application/xml,text/xml,text/html", fresh);
    const fromFeed = text ? parseRssEntries(text, source.url) : [];
    const fromSitemap = text ? await collectEntriesFromSitemap(source.url, text) : [];
    const fromHtml = text ? collectEntriesFromHtmlLinks(text, source.url) : [];
    return dedupeEntries([...fromFeed, ...fromSitemap, ...fromHtml]).slice(0, ENTRY_LIMIT_PER_SOURCE);
  }

  const html = await fetchSourceText(source.url, "text/html,application/xhtml+xml,application/xml,text/xml", fresh);
  if (!html) return [];

  const aggregated: SourceEntry[] = [];
  const feedUrls = discoverFeedUrlsFromHtml(html, source.url);
  for (const feedUrl of feedUrls) {
    const feedText = await fetchSourceText(feedUrl, "application/rss+xml,application/atom+xml,application/xml,text/xml,text/html", fresh);
    if (!feedText) continue;
    aggregated.push(...parseRssEntries(feedText, feedUrl));
    if (aggregated.length >= ENTRY_LIMIT_PER_SOURCE * 2) break;
  }

  const fromSitemap = await collectEntriesFromSitemap(source.url, html);
  const fromHtml = collectEntriesFromHtmlLinks(html, source.url);
  return dedupeEntries([...aggregated, ...fromSitemap, ...fromHtml]).slice(0, ENTRY_LIMIT_PER_SOURCE);
}

function discoverFeedUrlsFromHtml(html: string, pageUrl: string) {
  const urls = new Set<string>();
  const linkTags = html.match(/<link[^>]+>/gi) || [];

  for (const tag of linkTags) {
    const rel = getAttr(tag, "rel")?.toLowerCase() || "";
    if (!rel.includes("alternate")) continue;
    const type = getAttr(tag, "type")?.toLowerCase() || "";
    if (!(type.includes("rss") || type.includes("atom") || type.includes("xml"))) continue;
    const href = getAttr(tag, "href");
    const normalized = href ? normalizeEntryUrl(href, pageUrl) : null;
    if (normalized) urls.add(normalized);
  }

  const parsed = new URL(pageUrl);
  const origin = parsed.origin;
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  const ancestors = buildPathAncestors(normalizedPath);
  const pathCandidates = [
    "/feed",
    "/feed/",
    "/rss",
    "/rss.xml",
    "/atom.xml",
    "/feed.xml",
    ...ancestors.flatMap((path) => [
      `${path}/feed`,
      `${path}/feed/`,
      `${path}/rss`,
      `${path}/rss.xml`,
      `${path}/atom.xml`,
      `${path}/feed.xml`,
      `${path}.rss`,
      `${path}.xml`,
    ]),
  ].filter(Boolean);

  for (const path of pathCandidates) {
    try {
      if (path.startsWith("http://") || path.startsWith("https://")) {
        urls.add(path);
      } else if (path.startsWith("/")) {
        urls.add(new URL(path, origin).toString());
      } else {
        urls.add(new URL(path, pageUrl).toString());
      }
    } catch {
      // ignore
    }
  }

  return [...urls];
}

function buildPathAncestors(pathname: string) {
  if (!pathname || pathname === "/") return [];
  const parts = pathname.split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let i = parts.length; i >= 1; i -= 1) {
    ancestors.push(`/${parts.slice(0, i).join("/")}`);
  }
  return ancestors;
}

function getAttr(tag: string, attr: string) {
  const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function dedupeEntries(entries: SourceEntry[]) {
  const seen = new Set<string>();
  const cleaned: SourceEntry[] = [];
  for (const entry of entries) {
    const normalized = normalizeUrl(entry.url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push({ ...entry, url: normalized });
  }
  return cleaned;
}

function parseRssEntries(xml: string, baseUrl: string) {
  const entries: SourceEntry[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = normalizeDisplayText(decodeXml(stripTags(matchTag(block, "title"))).trim());
    const linkRaw = decodeXml(matchTag(block, "link")).trim();
    const descriptionRaw = matchTag(block, "description");
    const contentRaw = matchTag(block, "content:encoded");
    const description = normalizeDisplayText(stripTags(decodeXml(descriptionRaw)).trim());
    const contentSummary = normalizeDisplayText(stripTags(decodeXml(contentRaw)).trim());
    const summary = pickBestSummary(description, contentSummary);
    const descriptionHtml = matchTag(block, "description");
    const thumbnailRaw =
      extractRssImageMedia(block) ||
      extractRssImageEnclosure(block) ||
      extractFirstImageSrc(descriptionHtml) ||
      extractFirstImageSrc(contentRaw);
    const thumbnailUrl = thumbnailRaw ? normalizeEntryUrl(decodeXml(thumbnailRaw), baseUrl) : null;
    const link = normalizeEntryUrl(linkRaw, baseUrl);
    if (!link) continue;
    // Skip asset/font/binary URLs that sometimes appear in RSS <link> fields
    if (isAssetLikeContentUrl(link)) continue;
    // Skip obvious index/pagination URLs (e.g. /archive/3, /page/2)
    if (isRssPaginationUrl(link)) continue;
    entries.push({
      title,
      url: link,
      summary: summary || undefined,
      thumbnailUrl: thumbnailUrl || undefined,
    });
  }
  if (entries.length > 0) return entries;

  const entryBlocks = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of entryBlocks) {
    const title = normalizeDisplayText(decodeXml(stripTags(matchTag(block, "title"))).trim());
    const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    const altMatch = block.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]*>/i);
    const linkRaw = (altMatch?.[1] || hrefMatch?.[1] || "").trim();
    const summaryRaw = matchTag(block, "summary") || matchTag(block, "content");
    const summary = normalizeDisplayText(stripTags(decodeXml(summaryRaw)).trim());
    const thumbnailRaw = extractAtomImageEnclosure(block) || extractFirstImageSrc(summaryRaw);
    const thumbnailUrl = thumbnailRaw ? normalizeEntryUrl(decodeXml(thumbnailRaw), baseUrl) : null;
    const link = normalizeEntryUrl(linkRaw, baseUrl);
    if (!link) continue;
    if (isAssetLikeContentUrl(link)) continue;
    if (isRssPaginationUrl(link)) continue;
    entries.push({
      title,
      url: link,
      summary: summary || undefined,
      thumbnailUrl: thumbnailUrl || undefined,
    });
  }
  return entries;
}

async function collectEntriesFromSitemap(pageUrl: string, pageHtml?: string) {
  const sitemapUrls = discoverSitemapUrlsFromHtml(pageHtml ?? "", pageUrl);
  if (sitemapUrls.length === 0) return [];

  const collected: SourceEntry[] = [];
  for (const sitemapUrl of sitemapUrls.slice(0, 12)) {
    const sitemapText = await fetchSourceText(sitemapUrl, "application/xml,text/xml,text/html");
    if (!sitemapText) continue;

    const nestedLocs = parseSitemapLocs(sitemapText, sitemapUrl);
    const hasNestedSitemaps = /<sitemapindex[\s>]/i.test(sitemapText);
    if (hasNestedSitemaps && nestedLocs.length > 0) {
      for (const nested of nestedLocs.slice(0, 20)) {
        const nestedText = await fetchSourceText(nested, "application/xml,text/xml,text/html");
        if (!nestedText) continue;
        collected.push(...buildSitemapEntries(parseSitemapLocs(nestedText, nested), pageUrl));
        if (collected.length >= ENTRY_LIMIT_PER_SOURCE * 2) break;
      }
    } else {
      collected.push(...buildSitemapEntries(nestedLocs, pageUrl));
    }
    if (collected.length >= ENTRY_LIMIT_PER_SOURCE * 2) break;
  }

  return dedupeEntries(collected).slice(0, ENTRY_LIMIT_PER_SOURCE);
}

function collectEntriesFromHtmlLinks(html: string, pageUrl: string) {
  const host = safeHost(pageUrl);
  if (!html || !host) return [] as SourceEntry[];

  const seen = new Set<string>();
  const entries: SourceEntry[] = [];

  const appendEntry = (rawUrl: string) => {
    if (entries.length >= ENTRY_LIMIT_PER_SOURCE) return;
    const normalized = normalizeEntryUrl(decodeXml(rawUrl.trim()), pageUrl);
    if (!normalized) return;
    if (isAssetLikeContentUrl(normalized)) return;
    if (!isLikelyArticleUrl(normalized, host) && !isFallbackContentUrl(normalized, host)) return;
    const key = canonicalEntryKey(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    entries.push({
      title: deriveTitleFromUrl(normalized),
      url: normalized,
    });
  };

  const hrefRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html))) {
    appendEntry(match[1]);
  }

  if (entries.length < ENTRY_LIMIT_PER_SOURCE) {
    for (const raw of extractUrlLikeTokens(html)) {
      appendEntry(raw);
      if (entries.length >= ENTRY_LIMIT_PER_SOURCE) break;
    }
  }

  return entries;
}

function extractUrlLikeTokens(text: string) {
  const candidates: string[] = [];
  const plainText = text.replace(/\\\//g, "/");

  const absoluteRe = /https?:\/\/[^\s"'<>\\]+/gi;
  let match: RegExpExecArray | null;
  while ((match = absoluteRe.exec(plainText))) {
    candidates.push(match[0]);
  }

  const pathRe = /\/[a-z0-9\-_/]{6,}/gi;
  while ((match = pathRe.exec(plainText))) {
    const token = match[0];
    if (token.includes("/blog/") || token.includes("/article/") || token.includes("/articles/") || token.includes("/post/") || token.includes("/story/") || token.includes("/stories/") || token.includes("/p/")) {
      candidates.push(token);
    }
  }

  return candidates;
}

function buildSitemapEntries(urls: string[], seedUrl: string) {
  const seedHost = safeHost(seedUrl);
  const seenKey = new Set<string>();
  const entries: SourceEntry[] = [];

  for (const candidate of urls) {
    if (isAssetLikeContentUrl(candidate)) continue;
    if (!isLikelyArticleUrl(candidate, seedHost) && !isFallbackContentUrl(candidate, seedHost)) continue;
    const key = canonicalEntryKey(candidate);
    if (!key || seenKey.has(key)) continue;
    seenKey.add(key);
    entries.push({
      title: deriveTitleFromUrl(candidate),
      url: candidate,
    });
  }

  return entries;
}

function discoverSitemapUrlsFromHtml(html: string, pageUrl: string) {
  const urls = new Set<string>();

  if (html) {
    const sitemapLinkTags = html.match(/<link[^>]+rel=["'][^"']*sitemap[^"']*["'][^>]*>/gi) || [];
    for (const tag of sitemapLinkTags) {
      const href = getAttr(tag, "href");
      const normalized = href ? normalizeEntryUrl(href, pageUrl) : null;
      if (normalized) urls.add(normalized);
    }
  }

  try {
    const parsed = new URL(pageUrl);
    const origin = parsed.origin;
    const preferred = parsed.hostname.includes("newneek.co")
      ? ["/sitemap/article-sitemap.xml", "/sitemap.xml"]
      : ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"];
    for (const path of preferred) {
      urls.add(new URL(path, origin).toString());
    }
  } catch {
    // ignore invalid url
  }

  return [...urls];
}

function parseSitemapLocs(xml: string, baseUrl: string) {
  const locs: string[] = [];
  const re = /<loc>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const normalized = normalizeEntryUrl(decodeXml(match[1].trim()), baseUrl);
    if (normalized) locs.push(normalized);
  }
  return locs;
}

function extractFirstImageSrc(html: string) {
  const img = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  return img?.[1] ?? null;
}

function extractRssImageMedia(block: string) {
  const thumbTag = block.match(/<media:thumbnail[^>]*>/i)?.[0];
  const thumbUrl = thumbTag ? getAttr(thumbTag, "url") : null;
  if (thumbUrl) return thumbUrl;

  const mediaTags = block.match(/<media:content[^>]*>/gi) || [];
  for (const tag of mediaTags) {
    const type = getAttr(tag, "type")?.toLowerCase() || "";
    const medium = getAttr(tag, "medium")?.toLowerCase() || "";
    const url = getAttr(tag, "url");
    if (!url) continue;
    if (type.includes("image") || medium === "image" || isLikelyImageUrl(url)) {
      return url;
    }
  }
  return null;
}

function extractRssImageEnclosure(block: string) {
  const enclosureTags = block.match(/<enclosure[^>]*>/gi) || [];
  for (const tag of enclosureTags) {
    const type = getAttr(tag, "type")?.toLowerCase() || "";
    const url = getAttr(tag, "url");
    if (!url) continue;
    if (type.includes("image") || isLikelyImageUrl(url)) {
      return url;
    }
  }
  return null;
}

function extractAtomImageEnclosure(block: string) {
  const enclosureTags = block.match(/<link[^>]+rel=["']enclosure["'][^>]*>/gi) || [];
  for (const tag of enclosureTags) {
    const href = getAttr(tag, "href");
    const type = getAttr(tag, "type")?.toLowerCase() || "";
    if (!href) continue;
    if (type.includes("image") || isLikelyImageUrl(href)) {
      return href;
    }
  }
  return null;
}

function isLikelyImageUrl(url: string) {
  return /\.(avif|webp|png|jpe?g|gif|bmp|svg)(?:$|[?#])/i.test(url);
}

function matchTag(text: string, tagName: string) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return re.exec(text)?.[1] ?? "";
}

function stripTags(text: string) {
  return text.replace(/<[^>]+>/g, " ");
}

function decodeXml(text: string) {
  const decoded = text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
  return decodeHtmlEntities(decoded);
}

function decodeHtmlEntities(text: string) {
  const named: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    laquo: '"',
    raquo: '"',
    ldquo: '"',
    rdquo: '"',
    lsquo: "'",
    rsquo: "'",
    ndash: "-",
    mdash: "-",
    hellip: "...",
  };

  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[entity.toLowerCase()] ?? "";
  });
}

/**
 * Safely decode percent-encoded sequences (e.g. %ED%85%8C → 테).
 * Handles multi-byte UTF-8 runs and silently skips malformed sequences
 * rather than throwing, so legitimate titles containing “%” are preserved.
 */
function safeDecodePercent(text: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return text;
  // Try full decode first (fast path).
  try {
    return decodeURIComponent(text);
  } catch {
    // Partial decode: greedily decode valid consecutive %XX runs (multi-byte aware).
    return text.replace(/((?:%[0-9A-Fa-f]{2})+)/g, (seq) => {
      try { return decodeURIComponent(seq); } catch { return seq; }
    });
  }
}

function normalizeDisplayText(text: string) {
  return safeDecodePercent(text)
    .replace(/\u00a0/g, " ")
    .replace(/<!\[CDATA\[/gi, " ")
    .replace(/\]\]>/g, " ")
    .replace(/&lt;!\[CDATA\[/gi, " ")
    .replace(/\]\]&gt;/gi, " ")
    .replace(/[«»]/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/(^|\s)[>»]+(?=\s|$)/g, " ")
    .replace(/^\s*[\-*•·]+\s*/, "")
    .replace(/\s+\*\s+/g, " ")
    .replace(/(?:\s*[-–—]\s*|\s+)[a-f0-9]{8,16}$/i, "")
    .replace(/^[\s\-:|>]+/, "")
    .replace(/[\s\-:|>]+$/, "")
    .replace(/\bDiscussion\s*\|\s*Link\b/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFeedItemText(item: Record<string, unknown>) {
  const next = { ...item };
  if (typeof next.title === "string") {
    next.title = normalizeDisplayText(next.title);
  }
  if (typeof next.summary === "string") {
    next.summary = normalizeDisplayText(next.summary);
  }
  if (typeof next.sourceName === "string") {
    next.sourceName = normalizeDisplayText(next.sourceName);
  }

  const title = typeof next.title === "string" ? next.title : "";
  const sourceName = typeof next.sourceName === "string" ? next.sourceName : "";
  const summary = typeof next.summary === "string" ? next.summary : "";
  const url = typeof next.url === "string" ? next.url : "";
  if (isWeakEntryTitle(title, sourceName)) {
    const fromSummary = buildFallbackTitleFromSummary(summary, sourceName);
    if (!isWeakEntryTitle(fromSummary, sourceName)) {
      next.title = fromSummary;
    } else {
      const fromPath = derivePathTitleFromUrl(url);
      next.title = fromPath || sourceName || title;
    }
  }

  return next;
}

async function cleanupLegacyDisplayArtifacts(env: Env) {
  // Backfill cleanup for already-ingested cards so older slots render cleanly too.
  await env.DB.prepare(`
    UPDATE items
    SET title = trim(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(COALESCE(title, ''), '<![CDATA[', ' '),
              ']]>', ' '),
            '&lt;![CDATA[', ' '),
          ']]&gt;', ' '),
        '&raquo;', ' '),
      '»', ' ')
    ),
    summary = trim(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(COALESCE(summary, ''), '<![CDATA[', ' '),
              ']]>', ' '),
            '&lt;![CDATA[', ' '),
          ']]&gt;', ' '),
        '&raquo;', ' '),
      '»', ' ')
    )
    WHERE title LIKE '%]]>%'
       OR title LIKE '%<![CDATA[%'
       OR title LIKE '%&lt;![CDATA[%'
       OR title LIKE '%]]&gt;%'
       OR title LIKE '%&raquo;%'
       OR title LIKE '%»%'
       OR summary LIKE '%]]>%'
       OR summary LIKE '%<![CDATA[%'
       OR summary LIKE '%&lt;![CDATA[%'
       OR summary LIKE '%]]&gt;%'
       OR summary LIKE '%&raquo;%'
       OR summary LIKE '%»%'
  `).run();
}

async function cleanupWeakNumericTitles(env: Env) {
  await env.DB.prepare(`
    UPDATE items
    SET title = (
      SELECT s.name
      FROM sources s
      WHERE s.id = items.source_id
      LIMIT 1
    )
    WHERE length(trim(COALESCE(title, ''))) <= 8
      AND trim(COALESCE(title, '')) != ''
      AND trim(title) NOT GLOB '*[^0-9]*'
  `).run();
}

function safeHost(url: string) {
  return extractSourceHost(url);
}

/**
 * Domain aliases: English mirrors that map to a canonical Korean domain.
 * When both are registered as sources, the English variant is treated as the
 * same content so duplicates are suppressed at ingestion time.
 */
const DOMAIN_ALIASES: Record<string, string> = {
  "eng.blog.toss.im": "blog.toss.im",
};

function canonicalEntryKey(url: string) {
  try {
    if (isAssetLikeContentUrl(url)) return null;
    const parsed = new URL(url);
    const rawHost = parsed.hostname.toLowerCase();
    const host = DOMAIN_ALIASES[rawHost] ?? rawHost;
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (host.includes("bucketplace.com")) {
      const localized = normalizedPath.match(/^\/(ko|en|ja)\/post\/(.+)$/);
      if (localized?.[2]) return `${host}/post/${localized[2]}`;
    }
    return `${host}${normalizedPath}`;
  } catch {
    return null;
  }
}

function normalizeTitleKey(text: string) {
  return normalizeDisplayText(text)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildContentDedupKey(sourceId: number, title: string, url: string) {
  const titleKey = normalizeTitleKey(title);
  if (titleKey) return `${sourceId}|${titleKey}`;
  try {
    const parsed = new URL(url);
    return `${sourceId}|${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return `${sourceId}|${normalizeDisplayText(url).toLowerCase()}`;
  }
}

async function collectSeenContentDedupKeys(
  env: Env,
  userId: number,
  targetDate: string,
  currentItemIds: number[],
) {
  const seen = new Set<string>();
  const historical = await env.DB.prepare(`
    SELECT i.source_id AS sourceId, i.title AS title, i.url AS url
    FROM user_feed_slots fs
    JOIN items i ON i.id = fs.item_id
    WHERE fs.user_id = ? AND fs.date <> ?
  `).bind(userId, targetDate).all<{ sourceId: number; title: string; url: string }>();
  for (const row of historical.results ?? []) {
    seen.add(buildContentDedupKey(Number(row.sourceId), String(row.title ?? ""), String(row.url ?? "")));
  }

  if (currentItemIds.length > 0) {
    const placeholders = currentItemIds.map(() => "?").join(", ");
    const currentRows = await env.DB.prepare(`
      SELECT source_id AS sourceId, title, url
      FROM items
      WHERE id IN (${placeholders})
    `).bind(...currentItemIds).all<{ sourceId: number; title: string; url: string }>();
    for (const row of currentRows.results ?? []) {
      seen.add(buildContentDedupKey(Number(row.sourceId), String(row.title ?? ""), String(row.url ?? "")));
    }
  }
  return seen;
}

function isLikelyArticleUrl(url: string, seedHost: string) {
  try {
    if (isAssetLikeContentUrl(url)) return false;
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const tail = parts[parts.length - 1]?.toLowerCase() || "";
    if (seedHost && host !== seedHost) return false;
    if (!path || path === "/") return false;
    if (
      path.startsWith("/tag/") ||
      path.startsWith("/tags/") ||
      path.startsWith("/category/") ||
      path.startsWith("/categories/") ||
      path.startsWith("/author/") ||
      path.startsWith("/authors/") ||
      path.startsWith("/topic/") ||
      path.startsWith("/topics/") ||
      path.startsWith("/archive/") ||
      path.startsWith("/archives/") ||
      path.startsWith("/site-map/") ||
      path.startsWith("/sitemap/") ||
      path.startsWith("/ir/") ||
      path.startsWith("/investor-relations/")
    ) return false;
    if (["page", "index", "feed", "rss", "atom", "everything", "default.aspx", "default", "sitemap", "site-map"].includes(tail)) return false;

    if (host.includes("bucketplace.com")) {
      return /\/(ko|en|ja)\/post\//.test(path) || /\/post\//.test(path);
    }
    if (host.includes("newneek.co")) {
      return /\/article\/\d+/.test(path);
    }
    if (host.includes("generalist.com")) {
      return /^\/p\/[^/]+/.test(path);
    }

    if (/\/articles\/[^/]+/.test(path)) return true;
    if (/\/article\/[^/]+/.test(path)) return true;
    if (/\/post\/[^/]+/.test(path)) return true;
    if (/\/stories\/[^/]+/.test(path) || /\/story\/[^/]+/.test(path)) return true;
    if (/\/p\/[^/]+/.test(path)) return true;
    if (/\/blog\/[^/]+/.test(path)) {
      const blockedBlogSlugs = new Set([
        "everything",
        "design-systems",
        "product-updates",
        "operations",
        "infrastructure",
        "diagramming",
        "portfolio",
        "thought-leadership",
        "corpcore",
      ]);
      return !blockedBlogSlugs.has(tail);
    }
    return false;
  } catch {
    return false;
  }
}

function isFallbackContentUrl(url: string, seedHost: string) {
  try {
    if (isAssetLikeContentUrl(url)) return false;
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (seedHost && host !== seedHost) return false;

    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path || path === "/") return false;
    if (/\.(css|js|json|xml|txt|png|jpe?g|gif|svg|webp|avif|ico|pdf|zip)$/i.test(path)) return false;
    if (
      path.startsWith("/tag/") ||
      path.startsWith("/tags/") ||
      path.startsWith("/t/") ||
      path.startsWith("/category/") ||
      path.startsWith("/categories/") ||
      path.startsWith("/author/") ||
      path.startsWith("/authors/") ||
      path.startsWith("/topic/") ||
      path.startsWith("/topics/") ||
      path.startsWith("/archive/") ||
      path.startsWith("/archives/") ||
      path.startsWith("/site-map/") ||
      path.startsWith("/sitemap/") ||
      path.startsWith("/ir/") ||
      path.startsWith("/investor-relations/") ||
      path.startsWith("/search/") ||
      path.startsWith("/page/")
    ) return false;
    const segments = path.split("/").filter(Boolean);
    const tail = segments[segments.length - 1]?.toLowerCase() || "";
    if (["feed", "rss", "atom", "index", "page", "about", "contact", "receive", "subscribe", "unsubscribe", "login", "logout", "signup", "archive", "archives", "default.aspx", "default", "sitemap", "site-map"].includes(tail)) return false;
    // Require at least 2 meaningful segments (e.g. /year/slug or /section/slug).
    // Single-segment paths (/receive, /life) are almost never articles.
    if (segments.length < 2) return false;
    return tail.length >= 4;
  } catch {
    return false;
  }
}

function isRssPaginationUrl(url: string) {
  // Rejects obvious index/pagination URLs that sometimes appear in RSS feeds.
  // e.g. /archive/3  /page/5  /archives/2024  /category/news
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    // Block well-known index/pagination path prefixes
    if (
      path.startsWith("/archive/") ||
      path.startsWith("/archives/") ||
      path.startsWith("/page/") ||
      path.startsWith("/category/") ||
      path.startsWith("/categories/") ||
      path.startsWith("/tag/") ||
      path.startsWith("/tags/") ||
      path.startsWith("/site-map/") ||
      path.startsWith("/sitemap/") ||
      path.startsWith("/ir/") ||
      path.startsWith("/investor-relations/")
    ) return true;
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return true;
    const tail = parts[parts.length - 1].toLowerCase();
    // 1-3 digit tail = pagination number
    if (/^\d{1,3}$/.test(tail)) return true;
    // Known index-only slugs as the final segment
    if (["archive", "archives", "feed", "rss", "atom", "index", "home"].includes(tail)) return true;
    return false;
  } catch {
    return false;
  }
}

function isAssetLikeContentUrl(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const q = parsed.search.toLowerCase();
    if (
      path.includes("/wp-content/") ||
      path.includes("/wp-admin/") ||
      path.includes("admin-ajax") ||
      path.includes("/assets/") ||
      path.includes("/fonts/") ||
      path.includes("/_static/") ||
      path.includes("/dist/") ||
      path.includes("/static/") ||
      path.includes("/webmentions/") ||
      path.includes("/webmention/") ||
      path.includes("/api/") ||
      path.includes("/.well-known/") ||
      path.includes("/cdn-cgi/")
    ) return true;
    if (
      /\.(woff2?|ttf|otf|eot|css|js|mjs|map|json|xml|txt|ico|svg|png|jpe?g|webp|avif|gif|bmp|mp4|webm|mp3|wav|zip|gz|pdf)(?:$|[?#])/i.test(path)
    ) return true;
    if (q.includes("webfont") || q.includes("font")) return true;
    return false;
  } catch {
    return true;
  }
}

function isWeakEntryTitle(title: string, sourceName: string) {
  // Detect un-decoded percent-encoding before normalizing (e.g. "%ED%85%8C").
  if (/%[0-9A-Fa-f]{2}/.test(title)) return true;
  const normalized = normalizeDisplayText(title).toLowerCase();
  if (!normalized) return true;
  if (normalized === sourceName.toLowerCase()) return true;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return true;
  if (/^[a-z0-9-]{1,8}$/i.test(normalized)) return true;
  return false;
}

function pickBestSummary(primary: string, fallback: string) {
  const cleanedPrimary = normalizeDisplayText(primary);
  if (isUsableSummary(cleanedPrimary)) return cleanedPrimary;
  const cleanedFallback = normalizeDisplayText(fallback);
  return isUsableSummary(cleanedFallback) ? cleanedFallback : "";
}

function buildFallbackTitleFromSummary(summary: string, sourceName: string) {
  const cleaned = normalizeDisplayText(summary);
  if (cleaned.length >= 10) {
    return cleaned.slice(0, 56).trim();
  }
  return sourceName;
}

function isUsableSummary(summary: string) {
  if (!summary) return false;
  if (summary === "*" || summary === "-") return false;
  if (summary.length < 8) return false;
  return true;
}

function deriveTitleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (!last) return "";
    const decoded = decodeUrlSlug(last);
    const cleaned = decoded
      .replace(/[-_]+/g, " ")
      .replace(/[?&]source=[^\s]+/gi, "")
      .replace(/\b[a-f0-9]{8,}\b$/i, "")
      .replace(/\.[a-z0-9]+$/i, "")
      .trim();
    if (/^\d{3,8}$/.test(cleaned)) return "";
    return cleaned;
  } catch {
    return "";
  }
}

function derivePathTitleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const prev = decodeUrlSlug(parts[parts.length - 2]).replace(/[-_]+/g, " ").trim();
      const last = decodeUrlSlug(parts[parts.length - 1]).replace(/[-_]+/g, " ").trim();
      if (prev && last) return `${prev} ${last}`.trim();
    }
    return "";
  } catch {
    return "";
  }
}

function decodeUrlSlug(value: string) {
  let current = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(current.replace(/\+/g, " "));
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

function normalizeEntryUrl(url: string, baseUrl: string) {
  if (!url) return null;
  try {
    const parsed = new URL(url, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    stripTrackingQueryParams(parsed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripTrackingQueryParams(parsed: URL) {
  const keys = [...parsed.searchParams.keys()];
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (
      lower.startsWith("utm_") ||
      lower === "fbclid" ||
      lower === "gclid" ||
      lower === "mc_cid" ||
      lower === "mc_eid" ||
      lower === "_hsenc" ||
      lower === "_hsmi" ||
      lower === "igshid" ||
      lower === "ref" ||
      lower === "ref_src"
    ) {
      parsed.searchParams.delete(key);
    }
  }
}

function extractMetaDescription(html: string) {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i) ||
    html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:description["'][^>]*>/i);
  return m?.[1]?.trim() || null;
}

function extractMetaTitle(html: string) {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i) ||
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["'][^>]*>/i);
  return m?.[1]?.trim() || null;
}

async function ensureAuthTables(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS auth_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_sub TEXT NOT NULL,
      client_id TEXT,
      email TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      UNIQUE(provider, provider_sub),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT,
      ip_hint TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
}

async function ensureUserScopedTables(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_sources (
      user_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      level TEXT NOT NULL DEFAULT 'focus' CHECK (level IN ('core', 'focus', 'light')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, source_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_feed_slots (
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      slot_index INTEGER NOT NULL CHECK (slot_index IN (0, 1, 2)),
      item_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, date, slot_index),
      UNIQUE (user_id, date, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('keep', 'skip')),
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_item_tags (
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, item_id, tag),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_source_penalties (
      user_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, source_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_tag_penalties (
      user_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, tag),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_topic_penalties (
      user_id INTEGER NOT NULL,
      topic TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, topic),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_hidden_items (
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, date, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_user_hidden_items_user_date
    ON user_hidden_items(user_id, date)
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_replacement_monitors (
      user_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      seed_url TEXT,
      next_check_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_checked_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, source_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_replacement_monitors_due
    ON user_replacement_monitors(is_active, next_check_at)
  `).run();
}

async function hideItemForDate(env: Env, userId: number, targetDate: string, itemId: number) {
  if (!Number.isFinite(userId) || !Number.isFinite(itemId) || !targetDate) return;
  await ensureUserScopedTables(env);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO user_hidden_items (user_id, date, item_id)
    VALUES (?, ?, ?)
  `).bind(userId, targetDate, itemId).run();
  await env.DB.prepare(`
    DELETE FROM user_feed_slots
    WHERE user_id = ? AND date = ? AND item_id = ?
  `).bind(userId, targetDate, itemId).run();
}

async function enqueueReplacementMonitor(env: Env, userId: number, sourceId: number, seedUrl?: string | null) {
  if (!Number.isFinite(userId) || !Number.isFinite(sourceId)) return;
  await ensureUserScopedTables(env);
  await env.DB.prepare(`
    INSERT INTO user_replacement_monitors (
      user_id, source_id, seed_url, next_check_at, last_checked_at, failure_count, is_active, expires_at, updated_at
    )
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL, 0, 1, datetime('now', '+24 hours'), CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, source_id) DO UPDATE SET
      seed_url = COALESCE(excluded.seed_url, user_replacement_monitors.seed_url),
      next_check_at = CURRENT_TIMESTAMP,
      failure_count = 0,
      is_active = 1,
      expires_at = datetime('now', '+24 hours'),
      updated_at = CURRENT_TIMESTAMP
  `).bind(userId, sourceId, seedUrl ?? null).run();
}

async function processReplacementMonitorQueue(env: Env) {
  await ensureUserScopedTables(env);
  await ensureSourceRefreshTable(env);
  const due = await env.DB.prepare(`
    SELECT user_id, source_id
    FROM user_replacement_monitors
    WHERE is_active = 1
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      AND next_check_at <= CURRENT_TIMESTAMP
    ORDER BY next_check_at ASC
    LIMIT 20
  `).all<{ user_id: number; source_id: number }>();

  for (const row of due.results ?? []) {
    const userId = Number(row.user_id);
    const sourceId = Number(row.source_id);
    try {
      const source = await env.DB.prepare(`
        SELECT s.id, s.name, s.url, s.type
        FROM user_sources us
        JOIN sources s ON s.id = us.source_id
        WHERE us.user_id = ? AND us.source_id = ? AND us.is_active = 1
        LIMIT 1
      `).bind(userId, sourceId).first<{ id: number; name: string; url: string; type: SourceType }>();
      if (!source) {
        await env.DB.prepare(`
          UPDATE user_replacement_monitors
          SET is_active = 0, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND source_id = ?
        `).bind(userId, sourceId).run();
        continue;
      }

      await hydrateSourceItems(source, env, true);
      await ensureItemsFromSources(env, undefined, userId);
      await fillDateIfNeeded(getTodayIso(), env, userId);

      await env.DB.prepare(`
        UPDATE user_replacement_monitors
        SET last_checked_at = CURRENT_TIMESTAMP,
            next_check_at = datetime('now', '+10 minutes'),
            failure_count = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND source_id = ?
      `).bind(userId, sourceId).run();
    } catch {
      await env.DB.prepare(`
        UPDATE user_replacement_monitors
        SET last_checked_at = CURRENT_TIMESTAMP,
            next_check_at = datetime('now', '+10 minutes'),
            failure_count = failure_count + 1,
            is_active = CASE WHEN failure_count >= 12 THEN 0 ELSE is_active END,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND source_id = ?
      `).bind(userId, sourceId).run();
    }
  }
}

function parseGoogleAudiences(env: Env) {
  return (env.GOOGLE_CLIENT_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function handlePostAuthGoogle(request: Request, env: Env) {
  await ensureAuthTables(env);

  const secret = env.AUTH_JWT_SECRET?.trim();
  if (!secret) {
    return json({ error: "AUTH_NOT_CONFIGURED", detail: "Missing AUTH_JWT_SECRET" }, { status: 500 });
  }
  const audiences = parseGoogleAudiences(env);
  if (audiences.length === 0) {
    return json({ error: "AUTH_NOT_CONFIGURED", detail: "Missing GOOGLE_CLIENT_IDS" }, { status: 500 });
  }

  let body: { idToken?: string };
  try {
    body = (await request.json()) as { idToken?: string };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idToken = body.idToken?.trim();
  if (!idToken) return json({ error: "idToken is required" }, { status: 400 });

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience: audiences,
    });
    payload = verified.payload;
  } catch {
    return json({ error: "INVALID_GOOGLE_TOKEN" }, { status: 401 });
  }

  const providerSub = String(payload.sub ?? "");
  const email = String(payload.email ?? "").trim().toLowerCase();
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  const displayName = typeof payload.name === "string" ? payload.name.trim() : "";
  const avatarUrl = typeof payload.picture === "string" ? payload.picture.trim() : "";
  const aud = typeof payload.aud === "string" ? payload.aud : "";
  if (!providerSub || !email || !emailVerified) {
    return json({ error: "INVALID_GOOGLE_CLAIMS" }, { status: 401 });
  }

  let user = await env.DB.prepare("SELECT id, created_at FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: number; created_at: string }>();
  if (!user) {
    await env.DB.prepare(`
      INSERT INTO users (email, display_name, avatar_url, last_login_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(email, displayName || null, avatarUrl || null).run();
    user = await env.DB.prepare("SELECT id, created_at FROM users WHERE email = ? LIMIT 1")
      .bind(email)
      .first<{ id: number; created_at: string }>();
  } else {
    await env.DB.prepare(`
      UPDATE users
      SET display_name = COALESCE(NULLIF(?, ''), display_name),
          avatar_url = COALESCE(NULLIF(?, ''), avatar_url),
          last_login_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(displayName, avatarUrl, user.id).run();
  }
  if (!user) return json({ error: "AUTH_USER_UPSERT_FAILED" }, { status: 500 });

  await env.DB.prepare(`
    INSERT INTO auth_identities (user_id, provider, provider_sub, client_id, email, email_verified, last_used_at)
    VALUES (?, 'google', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(provider, provider_sub) DO UPDATE SET
      user_id = excluded.user_id,
      client_id = excluded.client_id,
      email = excluded.email,
      email_verified = excluded.email_verified,
      last_used_at = CURRENT_TIMESTAMP
  `).bind(user.id, providerSub, aud || null, email, emailVerified ? 1 : 0).run();

  const sid = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;
  const token = await signSessionToken({
    sub: String(user.id),
    sid,
    email,
    iat: now,
    exp,
  }, secret);

  const expiresAt = new Date(exp * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_hint)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    sid,
    user.id,
    expiresAt,
    request.headers.get("user-agent") || null,
    request.headers.get("cf-connecting-ip") || null
  ).run();

  return json({
    ok: true,
    token,
    user: {
      id: user.id,
      email,
      displayName: displayName || null,
      avatarUrl: avatarUrl || null,
      createdAt: user.created_at,
    },
  });
}

async function handleGetAuthMe(request: Request, env: Env) {
  await ensureAuthTables(env);
  const auth = await authenticateSession(request, env);
  if (!auth.ok) return json({ error: auth.error }, { status: 401 });
  return json({ user: auth.user });
}

async function handlePostAuthLogout(request: Request, env: Env) {
  await ensureAuthTables(env);
  const auth = await authenticateSession(request, env);
  if (!auth.ok) return json({ error: auth.error }, { status: 401 });

  await env.DB.prepare(`
    UPDATE sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(auth.sessionId).run();

  return json({ ok: true });
}

async function handleGetCalendar(env: Env, userId: number) {
  const rows = await env.DB.prepare(`
    SELECT
      ufs.date,
      COUNT(DISTINCT CASE WHEN un.content IS NOT NULL AND trim(un.content) != '' THEN ufs.item_id END) AS memoCount
    FROM user_feed_slots ufs
    LEFT JOIN user_notes un ON un.item_id = ufs.item_id AND un.user_id = ufs.user_id
    WHERE ufs.user_id = ?
    GROUP BY ufs.date
    ORDER BY ufs.date ASC
  `).bind(userId).all<{ date: string; memoCount: number }>();

  const user = await env.DB.prepare(
    `SELECT created_at FROM users WHERE id = ? LIMIT 1`
  ).bind(userId).first<{ created_at: string }>();

  const startDate = user?.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  return json({
    startDate,
    dates: (rows.results ?? []).map((r) => ({
      date: r.date,
      memoCount: Number(r.memoCount),
    })),
  });
}

async function handleDeleteAccount(request: Request, env: Env) {
  const auth = await authenticateSession(request, env);
  if (!auth.ok) return json({ error: auth.error }, { status: 401 });
  const userId = auth.user.id;
  // Revoke all sessions first
  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`
  ).bind(userId).run();
  // Delete user — CASCADE handles all user-scoped data
  await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
  return json({ ok: true });
}

function readBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

function textEncoder() {
  return new TextEncoder();
}

function base64UrlEncode(input: Uint8Array) {
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSha256(data: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder().encode(data));
  return new Uint8Array(signature);
}

async function signSessionToken(payload: AuthTokenPayload, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(textEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder().encode(JSON.stringify(payload)));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(unsigned, secret);
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function verifySessionToken(token: string, secret: string): Promise<AuthTokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, sigPart] = parts;
  const unsigned = `${headerPart}.${payloadPart}`;
  const expectedSig = base64UrlEncode(await hmacSha256(unsigned, secret));
  if (expectedSig !== sigPart) return null;

  try {
    const payloadText = new TextDecoder().decode(base64UrlDecode(payloadPart));
    const payload = JSON.parse(payloadText) as AuthTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) return null;
    if (!payload.sid || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

async function authenticateSession(request: Request, env: Env): Promise<
  | { ok: true; user: { id: number; email: string; displayName: string | null; avatarUrl: string | null; createdAt: string }; sessionId: string }
  | { ok: false; error: string }
> {
  const secret = env.AUTH_JWT_SECRET?.trim();
  if (!secret) return { ok: false, error: "AUTH_NOT_CONFIGURED" };
  const token = readBearerToken(request);
  if (!token) return { ok: false, error: "AUTH_TOKEN_REQUIRED" };
  const payload = await verifySessionToken(token, secret);
  if (!payload) return { ok: false, error: "INVALID_SESSION_TOKEN" };

  const userId = Number(payload.sub);
  if (!Number.isFinite(userId)) return { ok: false, error: "INVALID_SESSION_TOKEN" };

  const row = await env.DB.prepare(`
    SELECT s.id AS sessionId, s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
           u.id AS userId, u.email AS email, u.display_name AS displayName, u.avatar_url AS avatarUrl,
           u.created_at AS createdAt
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
    LIMIT 1
  `).bind(payload.sid).first<{
    sessionId: string;
    expiresAt: string;
    revokedAt: string | null;
    userId: number;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: string;
  }>();
  if (!row || row.revokedAt) return { ok: false, error: "SESSION_NOT_FOUND" };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { ok: false, error: "SESSION_EXPIRED" };
  if (row.userId !== userId) return { ok: false, error: "SESSION_USER_MISMATCH" };

  return {
    ok: true,
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      createdAt: row.createdAt,
    },
  };
}

async function handlePostNote(itemId: number, request: Request, env: Env, userId: number) {
  let body: { content?: string; tags?: string[] };
  try {
    body = (await request.json()) as { content?: string; tags?: string[] };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.content !== "string") {
    return json({ error: "content is required" }, { status: 400 });
  }

  await env.DB.prepare(`
    INSERT INTO user_notes (user_id, item_id, content, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, item_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `).bind(userId, itemId, body.content).run();

  const tags = parseTagsInput(body.tags);
  await env.DB.prepare("DELETE FROM user_item_tags WHERE user_id = ? AND item_id = ?")
    .bind(userId, itemId).run();
  if (tags.length > 0) {
    await env.DB.batch(
      tags.map((tag) =>
        env.DB.prepare(`
          INSERT OR IGNORE INTO user_item_tags (user_id, item_id, tag)
          VALUES (?, ?, ?)
        `).bind(userId, itemId, tag)
      )
    );
  }

  return json({ ok: true });
}

async function handleGetNote(itemId: number, env: Env, userId: number) {
  const row = await env.DB
    .prepare("SELECT content FROM user_notes WHERE user_id = ? AND item_id = ? LIMIT 1")
    .bind(userId, itemId)
    .first<{ content?: string }>();
  const tagRows = await env.DB.prepare(`
    SELECT tag FROM user_item_tags
    WHERE user_id = ? AND item_id = ?
    ORDER BY created_at DESC, tag ASC
    LIMIT 12
  `).bind(userId, itemId).all<{ tag: string }>();

  const itemRow = await env.DB.prepare(`
    SELECT i.title, i.url, s.name AS sourceName
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.id = ?
    LIMIT 1
  `).bind(itemId).first<{ title?: string; url?: string; sourceName?: string }>();
  const recommended = extractSignalFromItem(
    String(itemRow?.title ?? ""),
    String(itemRow?.sourceName ?? ""),
    String(itemRow?.url ?? ""),
  ).tags.slice(0, 6);

  return json({
    content: row?.content ?? "",
    tags: (tagRows.results ?? []).map((r) => String(r.tag)),
    recommendedTags: recommended,
  });
}

async function handleDeleteNote(itemId: number, env: Env, userId: number) {
  await env.DB.prepare("DELETE FROM user_notes WHERE user_id = ? AND item_id = ?").bind(userId, itemId).run();
  await env.DB.prepare("DELETE FROM user_item_tags WHERE user_id = ? AND item_id = ?").bind(userId, itemId).run();
  return json({ ok: true });
}

async function handleGetRelatedItemsByTag(itemId: number, env: Env, userId: number) {
  const tagsResult = await env.DB.prepare(`
    SELECT tag
    FROM user_item_tags
    WHERE user_id = ? AND item_id = ?
    LIMIT 12
  `).bind(userId, itemId).all<{ tag: string }>();
  const tags = (tagsResult.results ?? []).map((row) => String(row.tag));
  if (tags.length === 0) return json({ items: [] });

  const placeholders = tags.map(() => "?").join(", ");
  const rows = await env.DB.prepare(`
    SELECT i.id, i.title, i.url, s.name AS sourceName, COUNT(*) AS sharedTagCount
    FROM user_item_tags ut
    JOIN items i ON i.id = ut.item_id
    JOIN sources s ON s.id = i.source_id
    WHERE ut.user_id = ?
      AND ut.tag IN (${placeholders})
      AND ut.item_id != ?
      AND EXISTS (
        SELECT 1 FROM user_notes un
        WHERE un.user_id = ut.user_id
          AND un.item_id = ut.item_id
          AND trim(COALESCE(un.content, '')) <> ''
      )
    GROUP BY i.id, i.title, i.url, s.name
    ORDER BY sharedTagCount DESC, i.id DESC
    LIMIT 8
  `).bind(userId, ...tags, itemId).all<{ id: number; title: string; url: string; sourceName: string; sharedTagCount: number }>();

  return json({ items: rows.results ?? [] });
}

async function handlePatchSource(sourceId: number, request: Request, env: Env, userId: number) {
  let body: { isActive?: boolean; level?: SourceLevel };
  try {
    body = (await request.json()) as { isActive?: boolean; level?: SourceLevel };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: string[] = [];
  const params: (number | string)[] = [];

  if (typeof body.isActive === "boolean") {
    updates.push("is_active = ?");
    params.push(body.isActive ? 1 : 0);
  }

  if (typeof body.level === "string") {
    if (!["core", "focus", "light"].includes(body.level)) {
      return json({ error: "level must be core | focus | light" }, { status: 400 });
    }
    updates.push("level = ?");
    params.push(body.level);
  }

  if (updates.length === 0) {
    return json({ error: "isActive(boolean) or level is required" }, { status: 400 });
  }

  const result = await env.DB
    .prepare(`UPDATE user_sources SET ${updates.join(", ")} WHERE user_id = ? AND source_id = ?`)
    .bind(...params, userId, sourceId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    return json({ error: "source not found" }, { status: 404 });
  }

  return json({ ok: true });
}

async function handleDeleteSource(sourceId: number, env: Env, userId: number) {
  await env.DB.prepare(`
    DELETE FROM user_notes
    WHERE user_id = ?
      AND item_id IN (SELECT id FROM items WHERE source_id = ?)
  `).bind(userId, sourceId).run();
  await env.DB.prepare(`
    DELETE FROM user_reactions
    WHERE user_id = ?
      AND item_id IN (SELECT id FROM items WHERE source_id = ?)
  `).bind(userId, sourceId).run();
  await env.DB.prepare("DELETE FROM user_feed_slots WHERE user_id = ? AND source_id = ?").bind(userId, sourceId).run();

  const result = await env.DB
    .prepare("DELETE FROM user_sources WHERE user_id = ? AND source_id = ?")
    .bind(userId, sourceId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    return json({ error: "source not found" }, { status: 404 });
  }

  return json({ ok: true });
}
