-- Deactivate English Toss source for all users (blog.toss.im is the canonical Korean source)
UPDATE user_sources SET is_active = 0
WHERE source_id IN (
  SELECT id FROM sources WHERE url GLOB '*eng.blog.toss.im*'
);

-- Archive English Toss items that have no user notes attached
UPDATE items SET status = 'archived'
WHERE url GLOB 'https://eng.blog.toss.im/*'
  AND NOT EXISTS (
    SELECT 1 FROM user_notes un WHERE un.item_id = items.id
  );

-- Remove feed slots pointing to now-archived English Toss items
DELETE FROM user_feed_slots
WHERE item_id IN (
  SELECT id FROM items
  WHERE status = 'archived'
    AND url GLOB 'https://eng.blog.toss.im/*'
);
