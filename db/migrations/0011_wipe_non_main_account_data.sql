-- ============================================================
-- Preserve data for the main account (yssv6273@gmail.com) only.
-- All other accounts get their user-scoped data wiped clean.
--
-- This removes:
--   • user_sources   — prevents cross-account source bleed
--   • user_feed_slots — stale slots from contaminated seeding
--   • user_notes     — any accidental notes from test accounts
--   • user_reactions — any accidental reactions from test accounts
--
-- The main account's data is untouched.
-- Other accounts can re-add their own sources after login.
-- ============================================================

-- Identify main account user_id (sub-query used inline so no temp table needed)
DELETE FROM user_sources
WHERE user_id != (
  SELECT id FROM users WHERE email = 'yssv6273@gmail.com'
);

DELETE FROM user_feed_slots
WHERE user_id != (
  SELECT id FROM users WHERE email = 'yssv6273@gmail.com'
);

DELETE FROM user_notes
WHERE user_id != (
  SELECT id FROM users WHERE email = 'yssv6273@gmail.com'
);

DELETE FROM user_reactions
WHERE user_id != (
  SELECT id FROM users WHERE email = 'yssv6273@gmail.com'
);

-- Force feed regeneration for main account too — ensures clean slots
-- after all the algorithm fixes applied in this session.
DELETE FROM user_feed_slots
WHERE user_id = (
  SELECT id FROM users WHERE email = 'yssv6273@gmail.com'
);
