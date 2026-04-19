-- ============================================================
-- Remove items that slipped past the updated ingestion filters:
--   • WordPress admin/AJAX endpoints
--   • Site-map index pages
--   • IR / investor-relations index pages
--   • archive/N pagination pages (numeric-only tail segment)
--   • Items with no title, no summary, and no thumbnail
--     (zero-metadata entries that indicate a dead or unusable URL)
--
-- Also wipe user_feed_slots so every account regenerates cleanly
-- from the cleaned item set.
-- ============================================================

-- 1. WP admin / AJAX endpoints
DELETE FROM items
WHERE url LIKE '%/wp-admin/%'
   OR url LIKE '%admin-ajax%';

-- 2. Site-map index pages
DELETE FROM items
WHERE url LIKE '%/site-map/%'
   OR url LIKE '%/sitemap/%'
   OR url LIKE '%default.aspx%';

-- 3. IR / investor-relations index pages
DELETE FROM items
WHERE url LIKE '%/ir/%'
   OR url LIKE '%/investor-relations/%';

-- 4. Archive pagination (e.g. /archive/3, /archives/12)
DELETE FROM items
WHERE (url LIKE '%/archive/%' OR url LIKE '%/archives/%')
  AND (
    url GLOB '*/archive/[0-9]'
    OR url GLOB '*/archive/[0-9][0-9]'
    OR url GLOB '*/archive/[0-9][0-9][0-9]'
    OR url GLOB '*/archives/[0-9]'
    OR url GLOB '*/archives/[0-9][0-9]'
    OR url GLOB '*/archives/[0-9][0-9][0-9]'
  );

-- 5. Zero-metadata items: no title (or equals source name), no summary, no thumbnail
--    These are almost always dead links or tag/category placeholders.
DELETE FROM items
WHERE (summary IS NULL OR trim(summary) = '')
  AND (thumbnail_url IS NULL OR trim(thumbnail_url) = '')
  AND EXISTS (
    SELECT 1 FROM sources s
    WHERE s.id = items.source_id
      AND (
        items.title IS NULL
        OR trim(items.title) = ''
        OR lower(trim(items.title)) = lower(trim(s.name))
      )
      AND RTRIM(items.url, '/') != RTRIM(s.url, '/')
  );

-- 6. Reset feed slots → clean regeneration for all accounts
DELETE FROM user_feed_slots;
