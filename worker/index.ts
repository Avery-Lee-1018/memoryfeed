interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type ReactionType = "keep" | "skip";
type SourceType = "rss" | "blog";
type SourceLevel = "core" | "focus" | "light";
const FEED_START_DATE = "2026-04-01";
const ENTRY_LIMIT_PER_SOURCE = 18;
const KOREAN_ACCEPT_LANGUAGE = "ko-KR,ko;q=0.95,en-US;q=0.7,en;q=0.6";
const CRAWLER_USER_AGENT = "Mozilla/5.0 (compatible; MemoryFeedBot/1.0)";

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

      if (request.method === "GET" && url.pathname === "/api/thumbnail") {
        return handleGetThumbnail(request, url, ctx);
      }
      if (request.method === "GET" && url.pathname === "/api/feed/today") {
        return handleGetFeedToday(url, env, ctx);
      }
      if (request.method === "POST" && url.pathname === "/api/feed/replacement") {
        return handlePostFeedReplacement(request, env);
      }
      if (request.method === "POST" && url.pathname === "/api/reaction") {
        return handlePostReaction(request, env);
      }
      if (request.method === "GET" && url.pathname === "/api/sources") {
        return handleGetSources(env);
      }
      if (request.method === "POST" && url.pathname === "/api/sources") {
        return handlePostSources(request, env, ctx);
      }
      if (request.method === "PATCH" && /^\/api\/sources\/\d+$/.test(url.pathname)) {
        const sourceId = parseInt(url.pathname.split("/")[3]);
        return handlePatchSource(sourceId, request, env);
      }
      if (request.method === "DELETE" && /^\/api\/sources\/\d+$/.test(url.pathname)) {
        const sourceId = parseInt(url.pathname.split("/")[3]);
        return handleDeleteSource(sourceId, env);
      }
      if (request.method === "POST" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handlePostNote(itemId, request, env);
      }
      if (request.method === "DELETE" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
        const itemId = parseInt(url.pathname.split("/")[3]);
        return handleDeleteNote(itemId, env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown server error";
      return json({ error: "SERVER_ERROR", detail: message }, { status: 500 });
    }
  }
} satisfies ExportedHandler<Env>;

async function handleGetThumbnail(request: Request, url: URL, ctx: ExecutionContext) {
  const pageUrl = url.searchParams.get("pageUrl");
  const imageUrl = url.searchParams.get("imageUrl");

  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
    return new Response("Bad Request", { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // 1) Prefer explicit imageUrl if provided and reachable.
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
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
    CREATE TABLE IF NOT EXISTS feed_slots (
      date TEXT NOT NULL,
      slot_index INTEGER NOT NULL CHECK (slot_index IN (0, 1, 2)),
      item_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (date, slot_index),
      UNIQUE (date, item_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_feed_slots_date ON feed_slots(date)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_feed_slots_source_date ON feed_slots(source_id, date)").run();
}

async function handleGetFeedToday(url: URL, env: Env, ctx: ExecutionContext) {
  await ensureFeedSlotsTable(env);
  await cleanupDemoData(env);
  await ensureItemsFromSources(env);
  const targetDate = getDateParamOrToday(url.searchParams.get("date"));
  await backfillFeedsUntilDate(targetDate, env);
  let result = await queryDistinctDateItems(targetDate, env);

  const items = (result.results ?? []) as Record<string, unknown>[];

  // Always guarantee 3 items — prioritize source diversity for the same date.
  if (items.length < 3) {
    await fillDateIfNeeded(targetDate, env);
    result = await queryDistinctDateItems(targetDate, env);
  }

  const rows = (result.results ?? []) as Record<string, unknown>[];
  ctx.waitUntil((async () => {
    await Promise.allSettled([
      rehydrateWeakShownSources(rows, env),
      rehydrateRandomWeakSource(env),
    ]);
  })());
  const finalItems = rows.map(({ sourceId, ...rest }) => rest);
  return json({ date: targetDate, items: finalItems });
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

async function rehydrateRandomWeakSource(env: Env) {
  const source = await env.DB.prepare(`
    SELECT s.id, s.name, s.url, s.type
    FROM sources s
    JOIN items i ON i.source_id = s.id
    WHERE s.is_active = 1
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
  `).first<{ id: number; name: string; url: string; type: SourceType }>();

  if (!source) return;
  await hydrateSourceItems(source, env);
}

async function queryDistinctDateItems(targetDate: string, env: Env) {
  return env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType, s.level AS sourceLevel,
           i.source_id AS sourceId,
           n.content AS note,
           fs.slot_index AS slotIndex
    FROM feed_slots fs
    JOIN items i ON i.id = fs.item_id
    JOIN sources s ON s.id = i.source_id
    LEFT JOIN notes n ON n.item_id = i.id
    WHERE fs.date = ?
      AND s.is_active = 1
    ORDER BY fs.slot_index ASC
    LIMIT 3
  `).bind(targetDate).all();
}

async function handlePostFeedReplacement(request: Request, env: Env) {
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
      FROM feed_slots
      WHERE date = ? AND item_id = ?
      LIMIT 1
    `).bind(targetDate, body.replaceItemId).first<{ slot_index: number }>()
    : null;
  if (!slot) {
    return json({ item: null, reason: "item_not_in_today_slots" });
  }

  const todayRows = await env.DB.prepare(`
    SELECT item_id, source_id
    FROM feed_slots
    WHERE date = ?
  `).bind(targetDate).all();
  const todayItems = ((todayRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.item_id))
    .filter(Number.isFinite);
  const todaySources = ((todayRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.source_id))
    .filter(Number.isFinite);

  const fatigueRows = await env.DB.prepare(`
    SELECT DISTINCT source_id
    FROM feed_slots
    WHERE date < ?
      AND date >= date(?, '-3 day')
  `).bind(targetDate, targetDate).all();
  const fatiguedSources = ((fatigueRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.source_id))
    .filter(Number.isFinite);

  const excludedIds = [...new Set([...excludeItemIds, ...todayItems])];
  const excludedSources = [...new Set([...todaySources, ...fatiguedSources])];

  let replacementId: number | null = null;

  const preferred = await selectCandidateItemIds(env, {
    limit: 1,
    excludeItemIds: excludedIds,
    excludeSourceIds: excludedSources,
    requireNoMemo: true,
    distinctBySource: false,
  });
  if (preferred.length > 0) replacementId = preferred[0];

  if (!replacementId) {
    const fallbackUnassigned = await selectCandidateItemIds(env, {
      limit: 1,
      excludeItemIds: excludedIds,
      excludeSourceIds: todaySources,
      requireNoMemo: true,
      distinctBySource: false,
    });
    if (fallbackUnassigned.length > 0) replacementId = fallbackUnassigned[0];
  }

  if (!replacementId) {
    // Last-resort: allow any item even if already used on another date.
    const fallbackAny = await selectCandidateItemIds(env, {
      limit: 1,
      excludeItemIds: excludedIds,
      excludeSourceIds: [],
      requireNoMemo: false,
      distinctBySource: false,
      excludeAssigned: false,
    });
    if (fallbackAny.length > 0) replacementId = fallbackAny[0];
  }

  if (replacementId) {
    const replacementSource = await env.DB.prepare("SELECT source_id FROM items WHERE id = ? LIMIT 1")
      .bind(replacementId)
      .first<{ source_id: number }>();
    if (!replacementSource) return json({ item: null });

    await env.DB.prepare(`
      UPDATE feed_slots
      SET item_id = ?, source_id = ?
      WHERE date = ? AND slot_index = ?
    `)
      .bind(replacementId, replacementSource.source_id, targetDate, slot.slot_index)
      .run();
  }

  if (!replacementId) return json({ item: null });
  const finalReplacement = await env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType, s.level AS sourceLevel,
           n.content AS note
    FROM items i
    JOIN sources s ON i.source_id = s.id
    LEFT JOIN notes n ON n.item_id = i.id
    WHERE i.id = ?
    LIMIT 1
  `).bind(replacementId).first();
  return json({ item: finalReplacement ?? null });
}

async function handlePostReaction(request: Request, env: Env) {
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

  await env.DB.prepare("INSERT INTO reactions (item_id, type) VALUES (?, ?)")
    .bind(body.itemId, body.type).run();

  return json({ ok: true });
}

async function handleGetSources(env: Env) {
  const result = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.url,
      s.type,
      s.level,
      s.is_active,
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
      ) AS lastActivityAt
    FROM sources s
    LEFT JOIN items i ON i.source_id = s.id
    LEFT JOIN feed_slots fs ON fs.item_id = i.id
    LEFT JOIN notes n ON n.item_id = i.id
    GROUP BY s.id
    ORDER BY s.id DESC
  `).all();
  return json({ sources: result.results ?? [] });
}

async function handlePostSources(request: Request, env: Env, ctx: ExecutionContext) {
  let body: { name?: string; url?: string; type?: SourceType; rawText?: string; urls?: string[] };
  try {
    body = (await request.json()) as { name?: string; url?: string; type?: SourceType; rawText?: string; urls?: string[] };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.rawText === "string" || Array.isArray(body.urls)) {
    const { urls, totalCandidates, invalidTokens } = parseSourceUrls(body.rawText, body.urls);
    const existingRows = await env.DB
      .prepare("SELECT id, name, url, type FROM sources")
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
    for (const sourceUrl of urls) {
      const host = extractSourceHost(sourceUrl);
      const existingByHost = host ? sourceByHost.get(host) : undefined;
      if (existingByHost) {
        duplicateUrls.push(sourceUrl);
        ctx.waitUntil(hydrateSourceItems(existingByHost, env));
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
            await seedItemForSource(inserted, env);
            ctx.waitUntil(hydrateSourceItems(inserted, env));
            const insertedHost = extractSourceHost(inserted.url);
            if (insertedHost && !sourceByHost.has(insertedHost)) sourceByHost.set(insertedHost, inserted);
          }
        } else {
          duplicateUrls.push(sourceUrl);
          const existing = await env.DB
            .prepare("SELECT id, name, url, type FROM sources WHERE url = ? LIMIT 1")
            .bind(sourceUrl)
            .first<{ id: number; name: string; url: string; type: SourceType }>();
          if (existing) ctx.waitUntil(hydrateSourceItems(existing, env));
        }
      } catch {
        failedUrls.push(sourceUrl);
      }
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
      .prepare("SELECT id, name, url, type FROM sources")
      .all<{ id: number; name: string; url: string; type: SourceType }>();
    const match = (existing.results ?? []).find((row) => extractSourceHost(row.url) === incomingHost);
    if (match) {
      ctx.waitUntil(hydrateSourceItems(match, env));
      return json({ ok: true, duplicateByHost: true }, { status: 201 });
    }
  }

  await env.DB.prepare("INSERT INTO sources (name, url, type) VALUES (?, ?, ?)")
    .bind(body.name, body.url, body.type).run();
  const inserted = await env.DB
    .prepare("SELECT id, name, url, type FROM sources WHERE url = ? LIMIT 1")
    .bind(body.url)
    .first<{ id: number; name: string; url: string; type: SourceType }>();
  if (inserted) {
    await seedItemForSource(inserted, env);
    ctx.waitUntil(hydrateSourceItems(inserted, env));
  }

  return json({ ok: true }, { status: 201 });
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
  const itemExclusion = buildInClause("i.id", options.excludeItemIds);
  const sourceExclusion = buildInClause("i.source_id", options.excludeSourceIds);
  const memoClause = options.requireNoMemo ? "AND (n.content IS NULL OR trim(n.content) = '')" : "";
  // Exclude items already scheduled on ANY date unless caller explicitly allows reuse.
  const assignedClause = options.excludeAssigned !== false
    ? "AND NOT EXISTS (SELECT 1 FROM feed_slots fs_chk WHERE fs_chk.item_id = i.id)"
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
            CASE COALESCE(s.level, 'focus')
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
        JOIN sources s ON i.source_id = s.id
        LEFT JOIN notes n ON n.item_id = i.id
        WHERE i.status = 'active'
          AND s.is_active = 1
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
    JOIN sources s ON i.source_id = s.id
    LEFT JOIN notes n ON n.item_id = i.id
    WHERE i.status = 'active'
      AND s.is_active = 1
      ${memoClause}
      ${assignedClause}
      ${itemExclusion.sql}
      ${sourceExclusion.sql}
    ORDER BY (ABS(RANDOM()) % 1000000) * 1.0 /
      CASE COALESCE(s.level, 'focus')
        WHEN 'core' THEN 3.0
        WHEN 'focus' THEN 2.0
        WHEN 'light' THEN 1.0
        ELSE 2.0
      END
    LIMIT ?
  `).bind(
    ...itemExclusion.params,
    ...sourceExclusion.params,
    limit,
  ).all();

  return ((rows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.id))
    .filter(Number.isFinite);
}

async function fillDateIfNeeded(targetDate: string, env: Env) {
  const existing = await env.DB.prepare(`
    SELECT slot_index, item_id, source_id
    FROM feed_slots
    WHERE date = ?
    ORDER BY slot_index
    LIMIT 3
  `).bind(targetDate).all();
  const currentRows = (existing.results ?? []) as Record<string, unknown>[];
  const currentIds = currentRows.map((row) => Number(row.item_id)).filter(Number.isFinite);
  const currentSourceIds = currentRows.map((row) => Number(row.source_id)).filter(Number.isFinite);
  const existingSlots = new Set(currentRows.map((row) => Number(row.slot_index)).filter(Number.isFinite));
  const missingSlots = [0, 1, 2].filter((slot) => !existingSlots.has(slot));
  if (missingSlots.length <= 0) return;

  const fatigueRows = await env.DB.prepare(`
    SELECT DISTINCT source_id
    FROM feed_slots
    WHERE date < ?
      AND date >= date(?, '-3 day')
  `).bind(targetDate, targetDate).all();
  const fatiguedSourceIds = ((fatigueRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.source_id))
    .filter(Number.isFinite);

  const diverse = await selectCandidateItemIds(env, {
    limit: missingSlots.length,
    excludeItemIds: currentIds,
    excludeSourceIds: [...new Set([...currentSourceIds, ...fatiguedSourceIds])],
    requireNoMemo: true,
    distinctBySource: true,
  });

  let slotCursor = 0;
  for (const id of diverse) {
    const slot = missingSlots[slotCursor++];
    if (slot === undefined) break;
    const sourceRow = await env.DB.prepare("SELECT source_id FROM items WHERE id = ? LIMIT 1").bind(id).first<{ source_id: number }>();
    if (!sourceRow) continue;
    await env.DB.prepare(`
      INSERT OR REPLACE INTO feed_slots (date, slot_index, item_id, source_id)
      VALUES (?, ?, ?, ?)
    `).bind(targetDate, slot, id, sourceRow.source_id).run();
    currentIds.push(id);
    currentSourceIds.push(sourceRow.source_id);
  }

  const filledSlots = await env.DB.prepare("SELECT slot_index FROM feed_slots WHERE date = ?").bind(targetDate).all();
  const filledSet = new Set(((filledSlots.results ?? []) as Record<string, unknown>[]).map((r) => Number(r.slot_index)));
  const stillMissing = [0, 1, 2].filter((slot) => !filledSet.has(slot));
  if (stillMissing.length <= 0) return;

  const fallback = await selectCandidateItemIds(env, {
    limit: stillMissing.length,
    excludeItemIds: currentIds,
    excludeSourceIds: currentSourceIds,
    requireNoMemo: true,
    distinctBySource: true,
  });

  let fallbackCursor = 0;
  for (const id of fallback) {
    const slot = stillMissing[fallbackCursor++];
    if (slot === undefined) break;
    const sourceRow = await env.DB.prepare("SELECT source_id FROM items WHERE id = ? LIMIT 1").bind(id).first<{ source_id: number }>();
    if (!sourceRow) continue;
    await env.DB.prepare(`
      INSERT OR REPLACE INTO feed_slots (date, slot_index, item_id, source_id)
      VALUES (?, ?, ?, ?)
    `).bind(targetDate, slot, id, sourceRow.source_id).run();
    currentIds.push(id);
    currentSourceIds.push(sourceRow.source_id);
  }

  const finalSlots = await env.DB.prepare("SELECT slot_index FROM feed_slots WHERE date = ?").bind(targetDate).all();
  const finalSet = new Set(((finalSlots.results ?? []) as Record<string, unknown>[]).map((r) => Number(r.slot_index)));
  const finalMissing = [0, 1, 2].filter((slot) => !finalSet.has(slot));
  if (finalMissing.length <= 0) return;

  // Last-resort pass: allow reuse of items already on other dates if pool is exhausted.
  const relaxed = await selectCandidateItemIds(env, {
    limit: finalMissing.length,
    excludeItemIds: currentIds,
    excludeSourceIds: [],
    requireNoMemo: true,
    distinctBySource: false,
    excludeAssigned: false,
  });

  let relaxedCursor = 0;
  for (const id of relaxed) {
    const slot = finalMissing[relaxedCursor++];
    if (slot === undefined) break;
    const sourceRow = await env.DB.prepare("SELECT source_id FROM items WHERE id = ? LIMIT 1").bind(id).first<{ source_id: number }>();
    if (!sourceRow) continue;
    await env.DB.prepare(`
      INSERT OR REPLACE INTO feed_slots (date, slot_index, item_id, source_id)
      VALUES (?, ?, ?, ?)
    `).bind(targetDate, slot, id, sourceRow.source_id).run();
  }
}

async function backfillFeedsUntilDate(targetDate: string, env: Env) {
  const today = new Date().toISOString().slice(0, 10);
  const maxDate = targetDate > today ? today : targetDate;
  await fillDateIfNeeded(maxDate, env);
}

async function cleanupDemoData(env: Env) {
  await env.DB.prepare("DELETE FROM items WHERE url LIKE 'https://memoryfeed.local/%'").run();
  await env.DB.prepare("DELETE FROM sources WHERE url LIKE 'https://memoryfeed.local/%'").run();
}

async function ensureItemsFromSources(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT s.id, s.name, s.url, s.type, COUNT(i.id) AS itemCount
    FROM sources s
    LEFT JOIN items i ON i.source_id = s.id
    WHERE s.is_active = 1
    GROUP BY s.id
  `).all();

  for (const row of (rows.results ?? []) as Record<string, unknown>[]) {
    const source = {
      id: Number(row.id),
      name: String(row.name ?? ""),
      url: String(row.url ?? ""),
      type: (row.type === "rss" ? "rss" : "blog") as SourceType,
    };
    const itemCount = Number(row.itemCount ?? 0);
    if (itemCount === 0) {
      await seedItemForSource(source, env);
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
        FROM notes n
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

    const result = await env.DB.prepare(`
      INSERT INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
      VALUES (?, ?, ?, ?, ?, 'active', NULL)
      ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN items.title IS NULL OR trim(items.title) = '' THEN excluded.title
          WHEN lower(trim(items.title)) = lower(trim(?)) THEN excluded.title
          WHEN items.title LIKE 'http://%' OR items.title LIKE 'https://%' THEN excluded.title
          WHEN items.title LIKE '%&#%' THEN excluded.title
          WHEN items.title LIKE '%!%%' ESCAPE '!' THEN excluded.title
          ELSE items.title
        END,
        summary = CASE
          WHEN items.summary IS NULL OR trim(items.summary) = '' THEN excluded.summary
          WHEN items.summary LIKE '%&#%' THEN excluded.summary
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
    if (!isLikelyArticleUrl(normalized, host)) return;
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
    if (!isLikelyArticleUrl(candidate, seedHost)) continue;
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
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/^\s*[\-*•·]+\s*/, "")
    .replace(/\s+\*\s+/g, " ")
    .replace(/\bDiscussion\s*\|\s*Link\b/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHost(url: string) {
  return extractSourceHost(url);
}

function canonicalEntryKey(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
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
    return decoded
      .replace(/[-_]+/g, " ")
      .replace(/[?&]source=[^\s]+/gi, "")
      .replace(/\b[a-f0-9]{8,}\b$/i, "")
      .replace(/\.[a-z0-9]+$/i, "")
      .trim();
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
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractMetaDescription(html: string) {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  return m?.[1]?.trim() || null;
}

async function handlePostNote(itemId: number, request: Request, env: Env) {
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
    INSERT INTO notes (item_id, content, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(item_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `).bind(itemId, body.content).run();

  return json({ ok: true });
}

async function handleDeleteNote(itemId: number, env: Env) {
  await env.DB.prepare("DELETE FROM notes WHERE item_id = ?").bind(itemId).run();
  return json({ ok: true });
}

async function handlePatchSource(sourceId: number, request: Request, env: Env) {
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
    .prepare(`UPDATE sources SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...params, sourceId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    return json({ error: "source not found" }, { status: 404 });
  }

  return json({ ok: true });
}

async function handleDeleteSource(sourceId: number, env: Env) {
  const result = await env.DB
    .prepare("DELETE FROM sources WHERE id = ?")
    .bind(sourceId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    return json({ error: "source not found" }, { status: 404 });
  }

  return json({ ok: true });
}
