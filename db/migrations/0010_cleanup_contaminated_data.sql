-- ============================================================
-- Remove cross-account contamination left by the old
-- ensureUserSourcesSeeded that bulk-copied ALL global sources
-- to every new user on first login.
--
-- Strategy:
--   • Users who have written at least one note are "active" users
--     — their user_sources are preserved.
--   • Users with zero notes were seeded automatically and never
--     added sources themselves — wipe their user_sources so they
--     start clean and add only their own sources.
--
-- Additionally, delete ALL user_feed_slots across every account.
-- Slots generated before recent algorithm fixes (dedup, source
-- separation, 3-item guarantee) may be stale or buggy.
-- They will be regenerated correctly on the next feed load.
-- ============================================================

-- 1. Remove contaminated user_sources for users who have no notes
--    (accounts that were auto-seeded and never used interactively)
DELETE FROM user_sources
WHERE user_id NOT IN (SELECT DISTINCT user_id FROM user_notes);

-- 2. Force-refresh ALL feed slots so every account gets a clean
--    regeneration using the current fixed algorithm
DELETE FROM user_feed_slots;
