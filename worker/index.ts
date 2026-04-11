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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/thumbnail") {
      return handleGetThumbnail(url);
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

async function handleGetThumbnail(url: URL) {
  const rawUrl = url.searchParams.get("url");
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return new Response("Bad Request", { status: 400 });
  }

  const upstream = await fetch(rawUrl, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
    },
    cf: {
      cacheEverything: true,
      cacheTtl: 60 * 60 * 12
    }
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") || "image/jpeg",
      "cache-control": "public, max-age=43200"
    }
  });
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

  return json({ date: targetDate, items: result.results ?? [] });
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
      await env.DB.prepare("UPDATE items SET shown_date = NULL WHERE id = ?")
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
