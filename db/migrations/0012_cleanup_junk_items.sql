-- ============================================================
-- Remove junk items that slipped past ingestion filters:
--   • Font/asset files (.woff2, .woff, .ttf, .css, .js, etc.)
--   • WordPress /wp-content/ asset paths
--   • Webmention/webfont endpoints
--   • Items whose title = the source name AND url != source url
--     (tag/category pages that got scraped as articles)
--
-- Also wipe ALL user_feed_slots so every account gets a clean
-- regeneration using the fixed ingestion filters.
-- ============================================================

-- 1. Delete asset/binary items (font files, CSS, JS, etc.)
DELETE FROM items
WHERE
  url GLOB '*.woff2'
  OR url GLOB '*.woff'
  OR url GLOB '*.ttf'
  OR url GLOB '*.otf'
  OR url GLOB '*.eot'
  OR url GLOB '*.css'
  OR url GLOB '*.js'
  OR url LIKE '%/wp-content/%'
  OR url LIKE '%/webmentions/%'
  OR url LIKE '%/webmention/%'
  OR url LIKE '%/cdn-cgi/%'
  OR url LIKE '%/.well-known/%';

-- 2. Delete items whose title equals the source name AND url
--    differs from source url (these are tag/category placeholders,
--    not real articles — title = source name means buildFallbackTitle
--    failed to find any real content).
DELETE FROM items
WHERE EXISTS (
  SELECT 1 FROM sources s
  WHERE s.id = items.source_id
    AND lower(trim(items.title)) = lower(trim(s.name))
    AND RTRIM(items.url, '/') != RTRIM(s.url, '/')
    AND (items.summary IS NULL OR trim(items.summary) = '')
);

-- 3. Force-refresh ALL slots so every account benefits from the cleanup.
DELETE FROM user_feed_slots;
