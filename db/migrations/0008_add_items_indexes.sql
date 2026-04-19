-- Speed up feed candidate selection: JOIN on items.source_id was doing a full table scan
CREATE INDEX IF NOT EXISTS idx_items_source_id ON items(source_id);

-- Composite index covers the common pattern: source_id JOIN + status = 'active' filter
CREATE INDEX IF NOT EXISTS idx_items_source_status ON items(source_id, status);
