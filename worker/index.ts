interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type ReactionType = "keep" | "skip";
type SourceType = "rss" | "blog";

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
    if (request.method === "POST" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
      const itemId = parseInt(url.pathname.split("/")[3]);
      return handlePostNote(itemId, request, env);
    }
    if (request.method === "DELETE" && /^\/api\/notes\/\d+$/.test(url.pathname)) {
      const itemId = parseInt(url.pathname.split("/")[3]);
      return handleDeleteNote(itemId, env);
    }

    return env.ASSETS.fetch(request);
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
  if (!value) return new Date().toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

async function handleGetFeedToday(url: URL, env: Env) {
  const targetDate = getDateParamOrToday(url.searchParams.get("date"));
  const result = await env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType,
           n.content AS note
    FROM items i
    JOIN sources s ON i.source_id = s.id
    LEFT JOIN notes n ON n.item_id = i.id
    WHERE i.shown_date = ?
    LIMIT 3
  `).bind(targetDate).all();

  const items = (result.results ?? []) as Record<string, unknown>[];

  // Always guarantee 3 items — auto-fill from pool if short
  if (items.length < 3) {
    const needed = 3 - items.length;
    const existingIds = items.map(i => i.id as number);
    const exclusion = existingIds.length > 0
      ? `AND i.id NOT IN (${existingIds.map(() => "?").join(", ")})`
      : "";
    const fill = await env.DB.prepare(`
      SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
             s.name AS sourceName, s.type AS sourceType,
             n.content AS note
      FROM items i
      JOIN sources s ON i.source_id = s.id
      LEFT JOIN notes n ON n.item_id = i.id
      WHERE i.status = 'active'
        AND (i.shown_date IS NULL OR i.shown_date != ?)
        AND (n.content IS NULL OR trim(n.content) = '')
        ${exclusion}
      ORDER BY RANDOM()
      LIMIT ?
    `).bind(targetDate, ...existingIds, needed).all();

    for (const extra of (fill.results ?? []) as Record<string, unknown>[]) {
      await env.DB.prepare("UPDATE items SET shown_date = ? WHERE id = ?")
        .bind(targetDate, extra.id).run();
      items.push(extra);
    }
  }

  return json({ date: targetDate, items });
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

  const placeholders = excludeItemIds.map(() => "?").join(", ");
  const exclusionClause =
    excludeItemIds.length > 0 ? `AND i.id NOT IN (${placeholders})` : "";
  const targetDate = getDateParamOrToday(body.date ?? null);

  const stmt = env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType,
           n.content AS note
    FROM items i
    JOIN sources s ON i.source_id = s.id
    LEFT JOIN notes n ON n.item_id = i.id
    WHERE i.status = 'active'
      AND (i.shown_date IS NULL OR i.shown_date != ?)
      AND (n.content IS NULL OR trim(n.content) = '')
      ${exclusionClause}
    ORDER BY RANDOM()
    LIMIT 1
  `);

  const replacement = await stmt.bind(targetDate, ...excludeItemIds).first() as Record<string, unknown> | null;

  if (replacement) {
    await env.DB.prepare("UPDATE items SET shown_date = ? WHERE id = ?")
      .bind(targetDate, replacement.id)
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

  return json({ item: replacement ?? null });
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
  const result = await env.DB.prepare(
    "SELECT id, name, url, type, is_active FROM sources ORDER BY id DESC"
  ).all();
  return json({ sources: result.results ?? [] });
}

async function handlePostSources(request: Request, env: Env) {
  let body: { name?: string; url?: string; type?: SourceType };
  try {
    body = (await request.json()) as { name?: string; url?: string; type?: SourceType };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || !body.url || !body.type) {
    return json({ error: "name, url, and type are required" }, { status: 400 });
  }
  if (!["rss", "blog"].includes(body.type)) {
    return json({ error: "type must be rss | blog" }, { status: 400 });
  }

  await env.DB.prepare("INSERT INTO sources (name, url, type) VALUES (?, ?, ?)")
    .bind(body.name, body.url, body.type).run();

  return json({ ok: true }, { status: 201 });
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
