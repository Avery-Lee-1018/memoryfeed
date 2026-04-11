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

    if (request.method === "GET" && url.pathname === "/api/feed/today") {
      return handleGetFeedToday(env);
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

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

async function handleGetFeedToday(env: Env) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await env.DB.prepare(`
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType,
           n.content AS note
    FROM items i
    JOIN sources s ON i.source_id = s.id
    LEFT JOIN notes n ON n.item_id = i.id
    WHERE i.shown_date = ?
    LIMIT 3
  `).bind(today).all();

  return json({ date: today, items: result.results ?? [] });
}

async function handlePostFeedReplacement(request: Request, env: Env) {
  let body: { excludeItemIds?: number[] };
  try {
    body = (await request.json()) as { excludeItemIds?: number[] };
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const excludeItemIds = Array.isArray(body.excludeItemIds)
    ? body.excludeItemIds.filter((id): id is number => Number.isInteger(id))
    : [];

  const placeholders = excludeItemIds.map(() => "?").join(", ");
  const exclusionClause =
    excludeItemIds.length > 0 ? `AND i.id NOT IN (${placeholders})` : "";
  const today = new Date().toISOString().slice(0, 10);

  const stmt = env.DB.prepare(
    `
    SELECT i.id, i.title, i.url, i.summary, i.thumbnail_url,
           s.name AS sourceName, s.type AS sourceType,
           n.content AS note
    FROM items i
    JOIN sources s ON i.source_id = s.id
    LEFT JOIN notes n ON n.item_id = i.id
    WHERE i.status = 'active'
      ${exclusionClause}
    ORDER BY CASE WHEN i.shown_date = ? THEN 0 ELSE 1 END,
             i.last_seen_at IS NULL DESC,
             i.last_seen_at ASC,
             i.id DESC
    LIMIT 1
  `
  );

  const replacement = await stmt.bind(...excludeItemIds, today).first();
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
