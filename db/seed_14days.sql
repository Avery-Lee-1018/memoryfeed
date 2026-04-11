-- Fix item 70 URL
UPDATE items SET url = 'https://newsroom.spotify.com/2026-04-09/new-control-young-users-families/' WHERE id = 70;

-- Insert 26 new items (ids will be 71-96)
INSERT OR IGNORE INTO items (source_id, title, url, summary, status) VALUES
  -- NNGroup (source_id=1)
  (1, 'A Concrete Definition of an AI Agent', 'https://www.nngroup.com/articles/definition-ai-agent/', 'An AI agent pursues a goal by iteratively taking actions, evaluating progress, and deciding its own next steps.', 'active'),
  (1, 'GenUI vs. Vibe Coding: Who''s Designing?', 'https://www.nngroup.com/articles/genui-vs-vibe/', 'The distinction between generative UI and vibe coding determines accountability for either design judgment or execution quality.', 'active'),
  -- TechCrunch (source_id=3)
  (3, 'Kalshi wins temporary pause in Arizona criminal case', 'https://techcrunch.com/2026/04/11/kalshi-wins-temporary-pause-in-arizona-criminal-case/', 'The CFTC won a temporary restraining order preventing Arizona from pursuing its criminal case against prediction market Kalshi.', 'active'),
  (3, 'Sam Altman responds to ''incendiary'' New Yorker article after attack on his home', 'https://techcrunch.com/2026/04/11/sam-altman-responds-to-incendiary-new-yorker-article-after-attack-on-his-home/', 'The OpenAI CEO''s new blog post responds to both an apparent attack on his home and an in-depth New Yorker profile raising questions about his trustworthiness.', 'active'),
  (3, 'NASA Artemis II splashes down in Pacific Ocean in ''perfect'' landing for Moon mission', 'https://techcrunch.com/2026/04/10/nasa-artemis-ii-landing-pacific-ocean-splash-down/', 'The Integrity craft splashed down in the Pacific Ocean off the coast of San Diego just after 5:07 p.m. Pacific Time.', 'active'),
  -- Designboom (source_id=5)
  (5, 'Barry Webb photographs the macro world of slime molds hidden among UK woodlands', 'https://www.designboom.com/art/barry-webb-photographs-macro-world-slime-molds-uk-woodlands/', 'A photographer employs macro-photography to capture fleeting organisms in their natural woodland habitat.', 'active'),
  (5, 'Zim & Zou recreates vintage boombox and cassette tapes with handmade paper sculptures', 'https://www.designboom.com/art/zim-zou-vintage-boombox-cassette-tapes-handmade-paper-sculptures/', 'Designers create vibrant handmade artworks by layering, cutting, and folding colored paper into recognizable vintage audio devices.', 'active'),
  (5, 'Xi''an international football center opens its stadium bowl to the city through a porous form', 'https://www.designboom.com/architecture/xian-international-football-center-stadium-bowl-city-porous-form-yuanbo-jia-zhijun-lei/', 'An architectural proposal reimagines the stadium as open civic infrastructure rather than an isolated event-driven structure.', 'active'),
  -- Toss (source_id=6)
  (6, '홈택스를 방황하는 납세자를 위한 종합소득세 신고 유형별 안내서', 'https://toss.im/tossfeed/article/tossmoment-3', '종합소득세 신고가 처음인 프리랜서와 자영업자를 위한 8가지 신고 유형별 안내서입니다.', 'active'),
  (6, '청약 질문.zip', 'https://toss.im/tossfeed/series/housing-question', '청약 통장 활용법부터 당첨 확률 높이는 방법까지, 주택 청약에 대한 흔한 질문들을 정리했습니다.', 'active'),
  -- UX Collective (source_id=2)
  (2, 'Rethinking design critique', 'https://uxdesign.cc/rethinking-design-critique-3d358a859304', 'Explores how design critique functions as a collaborative knowledge-building process rather than mere feedback.', 'active'),
  (2, 'Notes from the people building your future', 'https://uxdesign.cc/notes-from-the-people-building-your-future-2a1c7a9dfbcd', 'Critical analysis of OpenAI''s industrial policy document, examining potential conflicts of interest in corporate governance proposals.', 'active'),
  (2, 'taste.md', 'https://uxdesign.cc/taste-md-e4fb75d9096f', 'Examines "taste" as an emerging technical buzzword in product design and AI contexts.', 'active'),
  (2, 'Beyond the user: why design needs to widen its circle', 'https://uxdesign.cc/beyond-the-user-why-design-needs-to-widen-its-circle-5d6d6bca783e', 'Advocates for humanity-centered design that considers environmental impact and ecosystems beyond individual user needs.', 'active'),
  (2, 'Data models: the shared language your AI and team are both missing', 'https://uxdesign.cc/data-models-the-shared-language-your-ai-and-team-are-both-missing-e36807c7f665', 'Demonstrates how explicit data modeling bridges communication gaps between design, product, engineering teams and AI systems.', 'active'),
  -- Spotify (source_id=28)
  (28, 'Get Festival-Ready With These 4 Spotify Features', 'https://newsroom.spotify.com/2026-04-09/festival-season-prep/', 'The platform highlights tools including SongDNA, collaborative playlists, Prompted Playlist, and Offline Backup to help users prepare for festival season.', 'active'),
  (28, 'Watch Bad Bunny''s Billions Club Live Concert on Spotify', 'https://newsroom.spotify.com/2026-04-08/watch-bad-bunny-billions-club-live-concert-film/', 'Spotify released a 42-minute concert film documenting Bad Bunny''s first-ever Asian performance from Tokyo in March 2026.', 'active'),
  (28, 'Prompted Playlist Levels Up to Include Podcasts', 'https://newsroom.spotify.com/2026-04-07/prompted-playlist-for-podcasts-launch/', 'The Prompted Playlist feature now enables podcast discovery alongside music, letting users describe preferences and receive personalized episode recommendations.', 'active'),
  -- Apple (source_id=29)
  (29, 'Apple Arcade, Nick Jr. Replay와 함께 온 가족을 위한 무한한 즐거움 선사', 'https://www.apple.com/kr/newsroom/2026/04/apple-arcade-brings-endless-family-fun-with-nick-jr-replay-on-may-7/', 'Apple Arcade가 5월 7일 Nick Jr. 캐릭터를 활용한 가족용 신규 게임 Nick Jr. Replay를 출시합니다.', 'active'),
  (29, 'Apple, 모든 규모의 비즈니스를 위한 신규 플랫폼 Apple Business 출시', 'https://www.apple.com/kr/newsroom/2026/03/introducing-apple-business/', 'Apple이 기기 관리와 고객 참여를 통합한 새로운 올인원 비즈니스 플랫폼을 공개했습니다.', 'active'),
  (29, 'Apple, 6월 8일 주간에 세계개발자회의(WWDC) 개최', 'https://www.apple.com/kr/newsroom/2026/03/apples-worldwide-developers-conference-returns-the-week-of-june-8/', 'Apple이 연례 세계개발자회의를 6월 8~12일 온라인으로 개최한다고 발표했습니다.', 'active'),
  (29, 'Apple, 전 세계에서 50주년 기념 행사 개최', 'https://www.apple.com/kr/newsroom/2026/03/apple-hosts-50th-anniversary-celebrations-around-the-world/', 'Apple이 창립 50주년을 맞아 뉴욕을 비롯한 전 세계 도시에서 기념 이벤트를 진행합니다.', 'active'),
  (29, 'Apple, AirPods Max 2 공개', 'https://www.apple.com/kr/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/', '개선된 노이즈 캔슬링과 H2 칩을 탑재한 AirPods Max 2세대가 공개됐습니다.', 'active'),
  -- Intercom (source_id=31)
  (31, 'Announcing Monitors: Opening the AI black box', 'https://www.intercom.com/blog/announcing-monitors-opening-the-ai-black-box/', 'Intercom launches Monitors, giving support teams real-time visibility into how their AI agent is performing and making decisions.', 'active'),
  -- Toss extra (source_id=6)
  (6, 'One Card for Transit, Payments, and Transfers in Korea', 'https://toss.im/tossfeed/article/korealifehacks-10-en', 'International residents can use a single Toss Bank debit card for transit, payments, and transfers without branch visits.', 'active'),
  -- Figma (source_id=8)
  (8, 'Introducing Figma AI', 'https://www.figma.com/blog/introducing-figma-ai/', 'Figma AI brings generative design tools directly into the editor, helping teams move from ideas to polished designs faster.', 'active');

-- Assign shown_dates for 14 days (Apr 12 = today already set, Apr 11 back to Mar 30)
UPDATE items SET shown_date = '2026-04-11' WHERE id IN (4, 5, 6);
UPDATE items SET shown_date = '2026-04-10' WHERE id IN (7, 8, 9);
UPDATE items SET shown_date = '2026-04-09' WHERE id IN (64, 65, 66);
UPDATE items SET shown_date = '2026-04-08' WHERE id IN (67, 68, 69);
UPDATE items SET shown_date = '2026-04-07' WHERE id IN (70, 71, 72);
UPDATE items SET shown_date = '2026-04-06' WHERE id IN (73, 74, 75);
UPDATE items SET shown_date = '2026-04-05' WHERE id IN (76, 77, 78);
UPDATE items SET shown_date = '2026-04-04' WHERE id IN (79, 80, 81);
UPDATE items SET shown_date = '2026-04-03' WHERE id IN (82, 83, 84);
UPDATE items SET shown_date = '2026-04-02' WHERE id IN (85, 86, 87);
UPDATE items SET shown_date = '2026-04-01' WHERE id IN (88, 89, 90);
UPDATE items SET shown_date = '2026-03-31' WHERE id IN (91, 92, 93);
UPDATE items SET shown_date = '2026-03-30' WHERE id IN (94, 95, 96);
