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
const ENTRY_LIMIT_PER_SOURCE = 30;
const RESURFACE_COOLDOWN_DAYS = 7;
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
      if (request.method === "DELETE" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handleDeleteNote(itemId, env, sessionUserId ?? 0);
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
  if ((method === "PATCH" || method === "DELETE") && /^\/api\/sources\/\d+$/.test(pathname)) return true;
  if ((method === "GET" || method === "POST" || method === "DELETE") && /^\/api\/notes\/\d+$/.test(pathname)) return true;
  return false;
}

function isAuthPath(pathname: string) {
  return pathname === "/api/auth/google" || pathname === "/api/auth/me" || pathname === "/api/auth/logout";
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

function isSafeImageHost(imageUrl: string, pageUrl: string) {
  try {
    const pageHost = new URL(pageUrl).hostname;
    const imageHost = new URL(imageUrl).hostname;
    return isHostRelated(imageHost, pageHost);
  } catch {
    return false;
  }
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
  if (imageUrl && /^https?:\/\//i.test(imageUrl) && isSafeImageHost(imageUrl, pageUrl)) {
    const direct = await fetchImage(imageUrl, pageUrl);
    if (direct) {
      ctx.waitUntil(cache.put(cacheKey, direct.clone()));
      return direct;
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
    }
  }

  // Last fallback: site favicon (still domain-specific) to avoid repeated generic placeholder.
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

  return new Response("Not Found", { status: 404 });
}

async function fetchImage(targetUrl: string, referer?: string) {
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
  await pruneDateItemsDuplicatedAcrossOtherDates(env, userId, targetDate);
  await pruneDateContentDuplicatesByKey(env, userId, targetDate);
  await ensureItemsFromSources(env, ctx, userId);
  await backfillFeedsUntilDate(targetDate, env, userId);
  let result = await queryDistinctDateItems(targetDate, env, userId);

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
    ]);
  })());
  const finalItems = rows.map(({ sourceId, ...rest }) => rest);
  return json({ date: targetDate, items: finalItems.map(sanitizeFeedItemText) });
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
      AND us.is_active = 1
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
  if (targetDate !== getTodayIso()) {
    return json({ item: null, reason: "replacement_allowed_only_for_today" });
  }

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
    limit: 1,
    excludeItemIds: excludedIds,
    excludeSourceIds: excludedSources,
    requireNoMemo: true,
    distinctBySource: false,
  });
  if (preferred.length > 0) replacementId = preferred[0];

  if (!replacementId) {
    const fallbackUnassigned = await selectCandidateItemIds(env, {
      userId,
      targetDate,
      limit: 1,
      excludeItemIds: excludedIds,
      excludeSourceIds: todaySources,
      requireNoMemo: true,
      distinctBySource: false,
    });
    if (fallbackUnassigned.length > 0) replacementId = fallbackUnassigned[0];
  }

  if (!replacementId) {
    // Last-resort: allow memoed items, but keep cross-date uniqueness.
    const fallbackAny = await selectCandidateItemIds(env, {
      userId,
      targetDate,
      limit: 1,
      excludeItemIds: excludedIds,
      excludeSourceIds: [],
      requireNoMemo: false,
      distinctBySource: false,
    });
    if (fallbackAny.length > 0) replacementId = fallbackAny[0];
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

  if (!replacementId) return json({ item: null });
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

async function handlePostReaction(request: Request, env: Env, userId: number) {
  let body: { itemId?: number; type?: ReactionType };
  try {
    body = (await request.json()) as { itemId?: number; type?: ReactionType };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.itemId !== "number" || !body.type) {
    return json({ error: "itemId and type are required" }, { status: 400 });
  }
  if (!["keep", "skip"].includes(body.type)) {
    return json({ error: "type must be keep | skip" }, { status: 400 });
  }

  const itemExists = await env.DB.prepare("SELECT id FROM items WHERE id = ? LIMIT 1")
    .bind(body.itemId).first();
  if (!itemExists) return json({ error: "item not found" }, { status: 404 });

  await env.DB.prepare("INSERT INTO user_reactions (user_id, item_id, type) VALUES (?, ?, ?)")
    .bind(userId, body.itemId, body.type).run();

  return json({ ok: true });
}

async function handleGetSources(env: Env, userId: number) {
  await ensureUserSourcesSeeded(env, userId);
  const result = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.url,
      s.type,
      us.level,
      us.is_active,
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
      CASE
        WHEN COUNT(DISTINCT CASE WHEN RTRIM(i.url, '/') <> RTRIM(s.url, '/') THEN i.id END) >= 2 THEN 'split'
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
    WHERE us.user_id = ?
    GROUP BY s.id, us.level, us.is_active
    ORDER BY s.id DESC
  `).bind(userId).all();
  return json({ sources: result.results ?? [] });
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
    let registeredOrReactivated = 0;
    for (const sourceUrl of urls) {
      const host = extractSourceHost(sourceUrl);
      const existingByHost = host ? sourceByHost.get(host) : undefined;
      if (existingByHost) {
        duplicateUrls.push(sourceUrl);
        await upsertUserSourceActive(env, userId, existingByHost.id);
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
      await ensureItemsFromSources(env, undefined, userId);
      await backfillFeedsUntilDate(getTodayIso(), env, userId);
    }

    const added = addedUrls.length;
    const duplicateCount = duplicateUrls.length;
    const invalidCount = invalidTokens.length;
    const failed = invalidCount + failedUrls.length;

    return json({
      ok: true,
      added,
      failed,
      invalidCount,
      duplicateCount,
      totalCandidates,
      validUniqueCount: urls.length,
      addedUrls,
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
  if (incomingHost) {
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
      await ensureItemsFromSources(env, undefined, userId);
      await backfillFeedsUntilDate(getTodayIso(), env, userId);
      ctx.waitUntil(hydrateSourceItems(match, env));
      return json({ ok: true, duplicateByHost: true }, { status: 201 });
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
    await ensureItemsFromSources(env, undefined, userId);
    await backfillFeedsUntilDate(getTodayIso(), env, userId);
    ctx.waitUntil(hydrateSourceItems(inserted, env));
  }

  return json({ ok: true }, { status: 201 });
}

async function upsertUserSourceActive(env: Env, userId: number, sourceId: number) {
  await env.DB.prepare(`
    INSERT INTO user_sources (user_id, source_id, is_active, level)
    VALUES (?, ?, 1, 'focus')
    ON CONFLICT(user_id, source_id) DO UPDATE SET
      is_active = 1
  `).bind(userId, sourceId).run();
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
  try {
    const parsed = new URL(input);
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

function extractSourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
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

async function selectCandidateItemIds(env: Env, options: CandidateQueryOptions) {
  const { userId, targetDate } = options;
  const itemExclusion = buildInClause("i.id", options.excludeItemIds);
  const sourceExclusion = buildInClause("i.source_id", options.excludeSourceIds);
  const memoClause = options.requireNoMemo ? "AND (n.content IS NULL OR trim(n.content) = '')" : "";
  // Keep memoed items excluded and allow memo-less resurfacing after cooldown.
  const assignedClause = options.excludeAssigned !== false
    ? `
      AND (n.content IS NULL OR trim(n.content) = '')
      AND NOT EXISTS (
        SELECT 1
        FROM user_feed_slots fs_chk
        WHERE fs_chk.item_id = i.id
          AND fs_chk.user_id = ?
          AND fs_chk.date >= date(?, '-${RESURFACE_COOLDOWN_DAYS} day')
      )
    `
    : "";
  const limit = Math.max(0, options.limit);
  if (limit === 0) return [] as number[];

  if (options.distinctBySource) {
    const rows = await env.DB.prepare(`
      WITH candidate AS (
        SELECT
          i.id,
          i.source_id,
          (ABS(RANDOM()) % 1000000) * 1.0 /
            CASE COALESCE(us.level, 'focus')
              WHEN 'core' THEN 3.0
              WHEN 'focus' THEN 2.0
              WHEN 'light' THEN 1.0
              ELSE 2.0
            END AS score,
          ROW_NUMBER() OVER (
            PARTITION BY i.source_id
            ORDER BY (ABS(RANDOM()) % 1000000)
          ) AS source_rank
        FROM items i
        JOIN user_sources us ON us.user_id = ? AND us.source_id = i.source_id
        JOIN sources s ON s.id = i.source_id
        LEFT JOIN user_notes n ON n.item_id = i.id AND n.user_id = ?
        WHERE i.status = 'active'
          AND us.is_active = 1
          AND NOT (
            RTRIM(i.url, '/') = RTRIM(s.url, '/')
            AND (i.summary IS NULL OR trim(i.summary) = '')
            AND lower(trim(COALESCE(i.title, ''))) = lower(trim(COALESCE(s.name, '')))
          )
          ${memoClause}
          ${assignedClause}
          ${itemExclusion.sql}
          ${sourceExclusion.sql}
      )
      SELECT id
      FROM candidate
      WHERE source_rank = 1
      ORDER BY score
      LIMIT ?
    `).bind(
      userId,
      userId,
      ...(options.excludeAssigned !== false ? [userId, targetDate] : []),
      ...itemExclusion.params,
      ...sourceExclusion.params,
      limit,
    ).all();

    return ((rows.results ?? []) as Record<string, unknown>[])
      .map((row) => Number(row.id))
      .filter(Number.isFinite);
  }

  const rows = await env.DB.prepare(`
    SELECT i.id
    FROM items i
    JOIN user_sources us ON us.user_id = ? AND us.source_id = i.source_id
    JOIN sources s ON s.id = i.source_id
    LEFT JOIN user_notes n ON n.item_id = i.id AND n.user_id = ?
    WHERE i.status = 'active'
      AND us.is_active = 1
      AND NOT (
        RTRIM(i.url, '/') = RTRIM(s.url, '/')
        AND (i.summary IS NULL OR trim(i.summary) = '')
        AND lower(trim(COALESCE(i.title, ''))) = lower(trim(COALESCE(s.name, '')))
      )
      ${memoClause}
      ${assignedClause}
      ${itemExclusion.sql}
      ${sourceExclusion.sql}
    ORDER BY (ABS(RANDOM()) % 1000000) * 1.0 /
      CASE COALESCE(us.level, 'focus')
        WHEN 'core' THEN 3.0
        WHEN 'focus' THEN 2.0
        WHEN 'light' THEN 1.0
        ELSE 2.0
      END
    LIMIT ?
  `).bind(
    userId,
    userId,
    ...(options.excludeAssigned !== false ? [userId, targetDate] : []),
    ...itemExclusion.params,
    ...sourceExclusion.params,
    limit,
  ).all();

  return ((rows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.id))
    .filter(Number.isFinite);
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
   */
  async function applyPass(candidates: number[]): Promise<void> {
    if (candidates.length === 0 || missingSlots.length === 0) return;
    const metaMap = await fetchItemMetaForItems(env, candidates);
    const assignments: Array<[slot: number, itemId: number, sourceId: number]> = [];
    let cursor = 0;
    for (const id of candidates) {
      const slot = missingSlots[cursor++];
      if (slot === undefined) break;
      const meta = metaMap.get(id);
      if (!meta) continue;
      const dedupKey = buildContentDedupKey(meta.sourceId, meta.title, meta.url);
      if (seenDedupKeys.has(dedupKey)) continue;
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

  // Pass 3: last resort — allow memoed items, any source
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
) {
  const inserted = await ingestItemsForSource(source, env);
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
) {
  const entries = await collectSourceEntries(source);
  if (entries.length === 0) return 0;

  let inserted = 0;
  for (const entry of entries.slice(0, ENTRY_LIMIT_PER_SOURCE)) {
    let resolvedTitle = normalizeDisplayText(entry.title || deriveTitleFromUrl(entry.url) || source.name);
    let resolvedSummary = entry.summary ? normalizeDisplayText(entry.summary) : null;
    let resolvedThumbnail = entry.thumbnailUrl ?? null;

    if (isWeakEntryTitle(resolvedTitle, source.name) || !isUsableSummary(resolvedSummary ?? "") || !resolvedThumbnail) {
      const html = await fetchSourceText(entry.url, "text/html,application/xhtml+xml");
      if (html) {
        if (isWeakEntryTitle(resolvedTitle, source.name)) {
          const htmlTitle = normalizeDisplayText((extractHtmlTitle(html) ?? "").replace(/\|\s*Substack.*$/i, "").trim());
          if (htmlTitle && !isWeakEntryTitle(htmlTitle, source.name)) {
            resolvedTitle = htmlTitle;
          }
        }
        if (!resolvedSummary || !isUsableSummary(resolvedSummary)) {
          const metaSummary = normalizeDisplayText(extractMetaDescription(html) ?? "");
          if (isUsableSummary(metaSummary)) {
            resolvedSummary = metaSummary;
          }
        }
        if (!resolvedThumbnail) {
          const metaImage = extractMetaImage(html, entry.url);
          if (metaImage) resolvedThumbnail = metaImage;
        }
      }
    }
    if (isWeakEntryTitle(resolvedTitle, source.name)) {
      resolvedTitle = buildFallbackTitleFromSummary(resolvedSummary ?? "", source.name);
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
        thumbnail_url = COALESCE(items.thumbnail_url, excluded.thumbnail_url)
    `).bind(
      source.id,
      resolvedTitle,
      entry.url,
      resolvedSummary,
      resolvedThumbnail,
      source.name,
    ).run();
    inserted += Number(result.meta?.changes ?? 0);
  }
  return inserted;
}

async function fetchSourceText(targetUrl: string, accept = "text/html,application/xhtml+xml,application/xml,text/xml") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(targetUrl, {
      headers: buildCrawlerHeaders(accept),
      signal: controller.signal,
      cf: { cacheEverything: true, cacheTtl: 60 * 30 },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type SourceEntry = { title: string; url: string; summary?: string; thumbnailUrl?: string };

async function collectSourceEntries(source: { url: string; type: SourceType }): Promise<SourceEntry[]> {
  if (source.type === "rss") {
    const text = await fetchSourceText(source.url, "application/rss+xml,application/atom+xml,application/xml,text/xml,text/html");
    const parsed = text ? dedupeEntries(parseRssEntries(text, source.url)) : [];
    if (parsed.length > 0) return parsed;
    const fromSitemap = text ? await collectEntriesFromSitemap(source.url, text) : [];
    if (fromSitemap.length > 0) return fromSitemap;
    return text ? collectEntriesFromHtmlLinks(text, source.url) : [];
  }

  const html = await fetchSourceText(source.url, "text/html,application/xhtml+xml,application/xml,text/xml");
  if (!html) return [];

  const feedUrls = discoverFeedUrlsFromHtml(html, source.url);
  for (const feedUrl of feedUrls) {
    const feedText = await fetchSourceText(feedUrl, "application/rss+xml,application/atom+xml,application/xml,text/xml,text/html");
    if (!feedText) continue;
    const entries = dedupeEntries(parseRssEntries(feedText, feedUrl));
    if (entries.length > 0) return entries;
  }

  const fromSitemap = await collectEntriesFromSitemap(source.url, html);
  if (fromSitemap.length > 0) return fromSitemap;
  return collectEntriesFromHtmlLinks(html, source.url);
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
  for (const sitemapUrl of sitemapUrls.slice(0, 6)) {
    const sitemapText = await fetchSourceText(sitemapUrl, "application/xml,text/xml,text/html");
    if (!sitemapText) continue;

    const nestedLocs = parseSitemapLocs(sitemapText, sitemapUrl);
    const hasNestedSitemaps = /<sitemapindex[\s>]/i.test(sitemapText);
    if (hasNestedSitemaps && nestedLocs.length > 0) {
      for (const nested of nestedLocs.slice(0, 8)) {
        const nestedText = await fetchSourceText(nested, "application/xml,text/xml,text/html");
        if (!nestedText) continue;
        collected.push(...buildSitemapEntries(parseSitemapLocs(nestedText, nested), pageUrl));
      }
    } else {
      collected.push(...buildSitemapEntries(nestedLocs, pageUrl));
    }
    if (collected.length >= ENTRY_LIMIT_PER_SOURCE) break;
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
      path.startsWith("/topics/")
    ) return false;
    if (["page", "index", "feed", "rss", "atom", "everything"].includes(tail)) return false;

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
      path.startsWith("/category/") ||
      path.startsWith("/categories/") ||
      path.startsWith("/author/") ||
      path.startsWith("/authors/") ||
      path.startsWith("/topic/") ||
      path.startsWith("/topics/")
    ) return false;
    const tail = path.split("/").filter(Boolean).pop()?.toLowerCase() || "";
    if (["feed", "rss", "atom", "index", "page", "about", "contact"].includes(tail)) return false;
    return tail.length >= 4;
  } catch {
    return false;
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
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    )
  `).run();
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

  let user = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: number }>();
  if (!user) {
    await env.DB.prepare(`
      INSERT INTO users (email, display_name, avatar_url, last_login_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(email, displayName || null, avatarUrl || null).run();
    user = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
      .bind(email)
      .first<{ id: number }>();
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
  | { ok: true; user: { id: number; email: string; displayName: string | null; avatarUrl: string | null }; sessionId: string }
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
           u.id AS userId, u.email AS email, u.display_name AS displayName, u.avatar_url AS avatarUrl
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
    },
  };
}

async function handlePostNote(itemId: number, request: Request, env: Env, userId: number) {
  let body: { content?: string };
  try {
    body = (await request.json()) as { content?: string };
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

  return json({ ok: true });
}

async function handleGetNote(itemId: number, env: Env, userId: number) {
  const row = await env.DB
    .prepare("SELECT content FROM user_notes WHERE user_id = ? AND item_id = ? LIMIT 1")
    .bind(userId, itemId)
    .first<{ content?: string }>();
  return json({ content: row?.content ?? "" });
}

async function handleDeleteNote(itemId: number, env: Env, userId: number) {
  await env.DB.prepare("DELETE FROM user_notes WHERE user_id = ? AND item_id = ?").bind(userId, itemId).run();
  return json({ ok: true });
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
