PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO sources (name, url, type) VALUES
  ('Memory Notes', 'https://memoryfeed.local/source/memory-notes', 'blog'),
  ('Daily Sparks', 'https://memoryfeed.local/source/daily-sparks', 'blog'),
  ('Idea Archive', 'https://memoryfeed.local/source/idea-archive', 'blog');

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 0-1',
       'https://memoryfeed.local/item/d-0-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-0 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 0-2',
       'https://memoryfeed.local/item/d-0-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-0 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 0-3',
       'https://memoryfeed.local/item/d-0-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-0 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 1-1',
       'https://memoryfeed.local/item/d-1-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-1 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 1-2',
       'https://memoryfeed.local/item/d-1-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-1 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 1-3',
       'https://memoryfeed.local/item/d-1-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-1 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 2-1',
       'https://memoryfeed.local/item/d-2-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-2 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 2-2',
       'https://memoryfeed.local/item/d-2-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-2 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 2-3',
       'https://memoryfeed.local/item/d-2-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-2 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 3-1',
       'https://memoryfeed.local/item/d-3-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-3 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 3-2',
       'https://memoryfeed.local/item/d-3-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-3 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 3-3',
       'https://memoryfeed.local/item/d-3-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-3 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 4-1',
       'https://memoryfeed.local/item/d-4-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-4 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 4-2',
       'https://memoryfeed.local/item/d-4-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-4 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 4-3',
       'https://memoryfeed.local/item/d-4-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-4 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 5-1',
       'https://memoryfeed.local/item/d-5-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-5 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 5-2',
       'https://memoryfeed.local/item/d-5-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-5 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 5-3',
       'https://memoryfeed.local/item/d-5-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-5 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 6-1',
       'https://memoryfeed.local/item/d-6-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-6 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 6-2',
       'https://memoryfeed.local/item/d-6-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-6 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 6-3',
       'https://memoryfeed.local/item/d-6-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-6 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 7-1',
       'https://memoryfeed.local/item/d-7-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-7 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 7-2',
       'https://memoryfeed.local/item/d-7-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-7 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 7-3',
       'https://memoryfeed.local/item/d-7-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-7 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 8-1',
       'https://memoryfeed.local/item/d-8-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-8 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 8-2',
       'https://memoryfeed.local/item/d-8-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-8 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 8-3',
       'https://memoryfeed.local/item/d-8-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-8 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 9-1',
       'https://memoryfeed.local/item/d-9-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-9 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 9-2',
       'https://memoryfeed.local/item/d-9-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-9 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 9-3',
       'https://memoryfeed.local/item/d-9-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-9 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 10-1',
       'https://memoryfeed.local/item/d-10-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-10 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 10-2',
       'https://memoryfeed.local/item/d-10-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-10 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 10-3',
       'https://memoryfeed.local/item/d-10-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-10 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 11-1',
       'https://memoryfeed.local/item/d-11-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-11 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 11-2',
       'https://memoryfeed.local/item/d-11-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-11 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 11-3',
       'https://memoryfeed.local/item/d-11-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-11 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 12-1',
       'https://memoryfeed.local/item/d-12-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-12 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 12-2',
       'https://memoryfeed.local/item/d-12-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-12 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 12-3',
       'https://memoryfeed.local/item/d-12-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-12 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '기억을 수면 위로 떠올리는 메모 13-1',
       'https://memoryfeed.local/item/d-13-s-1',
       '흩어진 생각을 다시 꺼내 오늘의 관점으로 재해석합니다.',
       '/thumbnails/01.png',
       'active',
       date('now', '-13 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/memory-notes';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '오늘의 영감을 저장하는 스파크 13-2',
       'https://memoryfeed.local/item/d-13-s-2',
       '짧은 인사이트 하나를 남기고 내일의 실행 단서로 연결합니다.',
       '/thumbnails/02.png',
       'active',
       date('now', '-13 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/daily-sparks';

INSERT OR IGNORE INTO items (source_id, title, url, summary, thumbnail_url, status, shown_date)
SELECT s.id,
       '다시 보고 싶은 아이디어 아카이브 13-3',
       'https://memoryfeed.local/item/d-13-s-3',
       '예전에 지나친 콘텐츠를 다시 읽고 새로운 연결을 찾습니다.',
       '/thumbnails/03.png',
       'active',
       date('now', '-13 day')
FROM sources s
WHERE s.url = 'https://memoryfeed.local/source/idea-archive';

