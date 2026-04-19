ALTER TABLE sources
ADD COLUMN level TEXT NOT NULL DEFAULT 'focus'
CHECK (level IN ('core', 'focus', 'light'));
