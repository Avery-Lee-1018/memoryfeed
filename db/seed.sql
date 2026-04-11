-- Sources
INSERT INTO sources (name, url, type) VALUES
  ('Nielsen Norman Group', 'https://www.nngroup.com/feed/rss/', 'rss'),
  ('UX Collective', 'https://uxdesign.cc/feed', 'rss'),
  ('TechCrunch', 'https://techcrunch.com/feed/', 'rss'),
  ('The Gradient', 'https://thegradient.pub/rss/', 'rss'),
  ('Designboom', 'https://www.designboom.com/feed/', 'rss'),
  ('토스피드', 'https://toss.im/tossfeed', 'blog'),
  ('당근 블로그', 'https://about.daangn.com/blog/', 'blog'),
  ('Figma Blog', 'https://www.figma.com/blog/', 'blog');

-- Sample items (shown_date = today → 바로 피드에 노출)
INSERT INTO items (source_id, title, url, summary, shown_date) VALUES
  (
    1,
    'Handmade Designs: The New Trust Signal',
    'https://www.nngroup.com/articles/handmade-designs/',
    'Users are increasingly drawn to imperfect, hand-crafted aesthetics online — a reaction against AI-polished visuals. Small inconsistencies now signal authenticity and human effort.',
    date('now')
  ),
  (
    5,
    'This Home in Korea Is Shaped by Twin Timber Gables Atop a Concrete Base',
    'https://www.designboom.com/architecture/home-korea-twin-timber-gables-concrete-base-brbb-architects-shin-dae-ri/',
    '서울 외곽의 주택 프로젝트. 콘크리트 기단 위에 목재 박공 두 개가 얹혀 독특한 실루엣을 만든다. 내부는 두 가족이 각자의 영역을 유지하면서도 연결되는 구조.',
    date('now')
  ),
  (
    4,
    'AGI Is Not Multimodal',
    'https://thegradient.pub/agi-is-not-multimodal/',
    'In projecting language back as the model for thought, we lose sight of the tacit embodied understanding that undergirds our intelligence. AGI framed purely as multimodal misses what cognition actually is.',
    date('now')
  );
