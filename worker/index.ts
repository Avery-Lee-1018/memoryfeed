interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type ReactionType = "keep" | "skip";
type SourceType = "rss" | "blog";
type SourceLevel = "core" | "focus" | "light";
const FEED_START_DATE = "2026-04-01";
const ENTRY_LIMIT_PER_SOURCE = 18;

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
        return handleGetFeedToday(url, env);
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
        return handlePostSources(request, env);
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
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; MemoryFeedBot/1.0)",
      accept: "text/html,application/xhtml+xml"
    },
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
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; MemoryFeedBot/1.0)",
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      ...(referer ? { referer } : {})
    },
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

function getDateParamOrToday(value: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = !value ? today : (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today);
  if (parsed < FEED_START_DATE) return FEED_START_DATE;
  return parsed;
}

async function handleGetFeedToday(url: URL, env: Env) {
  await cleanupDemoData(env);
  await ensureItemsFromSources(env);
  const targetDate = getDateParamOrToday(url.searchParams.get("date"));
  await backfillFeedsUntilDate(targetDate, env);
  let result = await queryDistinctDateItems(targetDate, env);

  const items = (result.results ?? []) as Record<string, unknown>[];

  // Always guarantee 3 items — prioritize source diversity for the same date.
  if (items.length < 3) {
    const existingIds = items.map((i) => Number(i.id)).filter(Number.isFinite);
    const existingSourceIds = items.map((i) => Number(i.sourceId)).filter(Number.isFinite);
    const neededDistinct = 3 - items.length;

    const diverse = await selectCandidateItemIds(env, {
      limit: neededDistinct,
      excludeItemIds: existingIds,
      excludeSourceIds: existingSourceIds,
      requireUnassigned: true,
      requireNoMemo: true,
      distinctBySource: true,
    });
    for (const id of diverse) {
      await env.DB.prepare("UPDATE items SET shown_date = ? WHERE id = ?").bind(targetDate, id).run();
      existingIds.push(id);
    }

    if (existingIds.length < 3) {
      const neededFallback = 3 - existingIds.length;
      const fallback = await selectCandidateItemIds(env, {
        limit: neededFallback,
        excludeItemIds: existingIds,
        excludeSourceIds: [],
        requireUnassigned: true,
        requireNoMemo: true,
        distinctBySource: false,
      });
      for (const id of fallback) {
        await env.DB.prepare("UPDATE items SET shown_date = ? WHERE id = ?").bind(targetDate, id).run();
        existingIds.push(id);
      }
    }

    result = await queryDistinctDateItems(targetDate, env);
  }

  const finalItems = ((result.results ?? []) as Record<string, unknown>[]).map(({ sourceId, ...rest }) => rest);
  return json({ date: targetDate, items: finalItems });
}

async function queryDistinctDateItems(targetDate: string, env: Env) {
  return env.DB.prepare(`
    WITH shown AS (
      SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
             s.name AS sourceName, s.type AS sourceType, s.level AS sourceLevel,
             i.source_id AS sourceId,
             n.content AS note,
             ROW_NUMBER() OVER (PARTITION BY i.source_id ORDER BY i.id DESC) AS source_rank
      FROM items i
      JOIN sources s ON i.source_id = s.id
      LEFT JOIN notes n ON n.item_id = i.id
      WHERE i.shown_date = ?
        AND s.is_active = 1
    )
    SELECT id, title, url, summary, thumbnail_url, sourceName, sourceType, sourceLevel, sourceId, note
    FROM shown
    WHERE source_rank = 1
    LIMIT 3
  `).bind(targetDate).all();
}

async function handlePostFeedReplacement(request: Request, env: Env) {
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

  const excludedSourceRows = excludeItemIds.length > 0
    ? await env.DB.prepare(`
      SELECT DISTINCT source_id
      FROM items
      WHERE id IN (${excludeItemIds.map(() => "?").join(", ")})
    `).bind(...excludeItemIds).all()
    : { results: [] as Record<string, unknown>[] };
  const excludedSourceIds = ((excludedSourceRows.results ?? []) as Record<string, unknown>[])
    .map((row) => Number(row.source_id))
    .filter(Number.isFinite);

  let replacementId: number | null = null;

  const preferred = await selectCandidateItemIds(env, {
    limit: 1,
    excludeItemIds,
    excludeSourceIds: excludedSourceIds,
    requireUnassigned: true,
    requireNoMemo: true,
    distinctBySource: false,
  });
  if (preferred.length > 0) replacementId = preferred[0];

  if (!replacementId) {
    const fallbackUnassigned = await selectCandidateItemIds(env, {
      limit: 1,
      excludeItemIds,
      excludeSourceIds: [],
      requireUnassigned: true,
      requireNoMemo: true,
      distinctBySource: false,
    });
    if (fallbackUnassigned.length > 0) replacementId = fallbackUnassigned[0];
  }

  if (!replacementId) {
    const fallbackAny = await selectCandidateItemIds(env, {
      limit: 1,
      excludeItemIds,
      excludeSourceIds: [],
      requireUnassigned: false,
      requireNoMemo: false,
      distinctBySource: false,
    });
    if (fallbackAny.length > 0) replacementId = fallbackAny[0];
  }

  if (replacementId) {
    await env.DB.prepare("UPDATE items SET shown_date = ? WHERE id = ?")
      .bind(targetDate, replacementId)
      .run();
    if (Number.isInteger(body.replaceItemId)) {
      await env.DB.prepare(`
        UPDATE items
        SET shown_date = NULL
        WHERE id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM notes n
            WHERE n.item_id = items.id
              AND trim(n.content) != ''
          )
      `)
        .bind(body.replaceItemId)
        .run();
    }
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
      COALESCE(COUNT(DISTINCT CASE WHEN i.shown_date IS NOT NULL THEN i.id END), 0) AS exposureCount,
      COALESCE(COUNT(DISTINCT CASE WHEN n.content IS NOT NULL AND trim(n.content) != '' THEN n.id END), 0) AS memoCount,
      MAX(i.shown_date) AS lastExposedAt,
      COALESCE(
        MAX(CASE
          WHEN n.updated_at IS NOT NULL
               AND (i.shown_date IS NULL OR n.updated_at > i.shown_date)
          THEN n.updated_at
          ELSE i.shown_date
        END),
        MAX(i.shown_date),
        MAX(n.updated_at)
      ) AS lastActivityAt
    FROM sources s
    LEFT JOIN items i ON i.source_id = s.id
    LEFT JOIN notes n ON n.item_id = i.id
    GROUP BY s.id
    ORDER BY s.id DESC
  `).all();
  return json({ sources: result.results ?? [] });
}

async function handlePostSources(request: Request, env: Env) {
  let body: { name?: string; url?: string; type?: SourceType; rawText?: string; urls?: string[] };
  try {
    body = (await request.json()) as { name?: string; url?: string; type?: SourceType; rawText?: string; urls?: string[] };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.rawText === "string" || Array.isArray(body.urls)) {
    const { urls, totalCandidates, invalidTokens } = parseSourceUrls(body.rawText, body.urls);

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
          }
        } else {
          duplicateUrls.push(sourceUrl);
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

  await env.DB.prepare("INSERT INTO sources (name, url, type) VALUES (?, ?, ?)")
    .bind(body.name, body.url, body.type).run();
  const inserted = await env.DB
    .prepare("SELECT id, name, url, type FROM sources WHERE url = ? LIMIT 1")
    .bind(body.url)
    .first<{ id: number; name: string; url: string; type: SourceType }>();
  if (inserted) {
    const count = await ingestItemsForSource(inserted, env);
    if (count === 0) {
      await seedItemForSource(inserted, env);
    }
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
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function inferSourceType(sourceUrl: string): SourceType {
  const lower = sourceUrl.toLowerCase();
  if (/(\/|\.)(rss|atom|feed)(\/|\.|$)/.test(lower) || lower.endsWith(".xml")) {
    return "rss";
  }
  return "blog";
}

async function resolveSourceName(sourceUrl: string, sourceType: SourceType) {
  const fallback = extractDomain(sourceUrl);
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; MemoryFeedBot/1.0)",
        accept: sourceType === "rss" ? "application/rss+xml,application/xml,text/xml,text/html" : "text/html,application/xhtml+xml,application/xml",
      },
      cf: { cacheEverything: true, cacheTtl: 60 * 30 },
    });
    if (!res.ok) return fallback;
    const text = await res.text();
    const extracted = sourceType === "rss" ? extractFeedTitle(text) : extractHtmlTitle(text);
    return extracted || fallback;
  } catch {
    return fallback;
  }
}

function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || null;
}

function extractFeedTitle(xml: string) {
  const channel = xml.match(/<channel[\s\S]*?<title>([^<]+)<\/title>/i);
  if (channel?.[1]) return channel[1].trim();
  const atom = xml.match(/<feed[\s\S]*?<title[^>]*>([^<]+)<\/title>/i);
  return atom?.[1]?.trim() || null;
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
  requireUnassigned: boolean;
  requireNoMemo: boolean;
  distinctBySource: boolean;
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
  const shownClause = options.requireUnassigned ? "AND i.shown_date IS NULL" : "";
  const memoClause = options.requireNoMemo ? "AND (n.content IS NULL OR trim(n.content) = '')" : "";
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
          ${shownClause}
          ${memoClause}
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
      ${shownClause}
      ${memoClause}
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
    SELECT i.id, i.source_id
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.shown_date = ?
      AND s.is_active = 1
    LIMIT 3
  `).bind(targetDate).all();
  const currentRows = (existing.results ?? []) as Record<string, unknown>[];
  const currentIds = currentRows.map((row) => Number(row.id)).filter(Number.isFinite);
  const currentSourceIds = currentRows.map((row) => Number(row.source_id)).filter(Number.isFinite);
  const uniqueSourceCount = new Set(currentSourceIds).size;
  const needed = 3 - uniqueSourceCount;
  if (needed <= 0) return;

  const diverse = await selectCandidateItemIds(env, {
    limit: needed,
    excludeItemIds: currentIds,
    excludeSourceIds: currentSourceIds,
    requireUnassigned: true,
    requireNoMemo: true,
    distinctBySource: true,
  });

  for (const id of diverse) {
    await env.DB.prepare("UPDATE items SET shown_date = ? WHERE id = ?")
      .bind(targetDate, id)
      .run();
    currentIds.push(id);
  }

  if (currentIds.length >= 3) return;

  const fallback = await selectCandidateItemIds(env, {
    limit: 3 - currentIds.length,
    excludeItemIds: currentIds,
    excludeSourceIds: [],
    requireUnassigned: true,
    requireNoMemo: true,
    distinctBySource: false,
  });

  for (const id of fallback) {
    await env.DB.prepare("UPDATE items SET shown_date = ? WHERE id = ?")
      .bind(targetDate, id)
      .run();
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

async function ingestItemsForSource(
  source: { id: number; name: string; url: string; type: SourceType },
  env: Env,
) {
  const entries = await collectSourceEntries(source);
  if (entries.length === 0) return 0;

  let inserted = 0;
  for (const entry of entries.slice(0, ENTRY_LIMIT_PER_SOURCE)) {
    const resolvedTitle = normalizeDisplayText(entry.title || deriveTitleFromUrl(entry.url) || source.name);
    const resolvedSummary = entry.summary ? normalizeDisplayText(entry.summary) : null;
    const result = await env.DB.prepare(`
      INSERT INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
      VALUES (?, ?, ?, ?, ?, 'active', NULL)
      ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN items.title IS NULL OR trim(items.title) = '' THEN excluded.title
          WHEN lower(trim(items.title)) = lower(trim(?)) THEN excluded.title
          WHEN items.title LIKE 'http://%' OR items.title LIKE 'https://%' THEN excluded.title
          ELSE items.title
        END,
        summary = CASE
          WHEN items.summary IS NULL OR trim(items.summary) = '' THEN excluded.summary
          ELSE items.summary
        END,
        thumbnail_url = COALESCE(items.thumbnail_url, excluded.thumbnail_url)
    `).bind(
      source.id,
      resolvedTitle,
      entry.url,
      resolvedSummary,
      entry.thumbnailUrl ?? null,
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
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; MemoryFeedBot/1.0)",
        accept,
      },
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
    return text ? dedupeEntries(parseRssEntries(text, source.url)) : [];
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

  return [];
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
  const pathCandidates = [
    "/feed",
    "/feed/",
    "/rss",
    "/rss.xml",
    "/atom.xml",
    "/feed.xml",
    normalizedPath ? `${normalizedPath}/feed` : "",
    normalizedPath ? `${normalizedPath}/feed/` : "",
    normalizedPath ? `${normalizedPath}/rss.xml` : "",
    normalizedPath ? `${normalizedPath}/atom.xml` : "",
    normalizedPath ? `${normalizedPath}.rss` : "",
    normalizedPath ? `${normalizedPath}.xml` : "",
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
    const description = normalizeDisplayText(decodeXml(stripTags(matchTag(block, "description"))).trim());
    const descriptionHtml = matchTag(block, "description");
    const thumbnailRaw =
      getAttr((block.match(/<media:content[^>]*>/i) || [""])[0], "url") ||
      getAttr((block.match(/<media:thumbnail[^>]*>/i) || [""])[0], "url") ||
      getAttr((block.match(/<enclosure[^>]+type=["'][^"']*image[^"']*["'][^>]*>/i) || [""])[0], "url") ||
      extractFirstImageSrc(descriptionHtml);
    const thumbnailUrl = thumbnailRaw ? normalizeEntryUrl(decodeXml(thumbnailRaw), baseUrl) : null;
    const link = normalizeEntryUrl(linkRaw, baseUrl);
    if (!link) continue;
    entries.push({
      title,
      url: link,
      summary: description || undefined,
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
    const summary = normalizeDisplayText(decodeXml(stripTags(summaryRaw)).trim());
    const enclosureMatch = block.match(/<link[^>]+rel=["']enclosure["'][^>]+href=["']([^"']+)["'][^>]*>/i);
    const thumbnailRaw = enclosureMatch?.[1] || extractFirstImageSrc(summaryRaw);
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

function extractFirstImageSrc(html: string) {
  const img = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  return img?.[1] ?? null;
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

function normalizeDisplayText(text: string) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveTitleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (!last) return "";
    return last
      .replace(/[-_]+/g, " ")
      .replace(/\.[a-z0-9]+$/i, "")
      .trim();
  } catch {
    return "";
  }
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
