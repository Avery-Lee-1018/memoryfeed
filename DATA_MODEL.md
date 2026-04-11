# Data Model

## sources
- id
- name
- url
- type (rss | blog)
  - `rss`: RSS/Atom 피드 URL → 피드 항목 자동 수집
  - `blog`: 블로그/채널 URL → 링크 크롤링으로 글 목록 자동 수집
- is_active

## items
- id
- source_id
- title
- url
- summary
- thumbnail_url — OG 이미지, 없으면 null (fallback placeholder 사용)
- status (active | archived) — 수집 상태
- shown_date — 오늘의 3개로 선정된 날짜 (cron이 기록)
- snoozed_until — 재노출 대기 날짜 (이 날짜 이후 다시 선정 대상)
- last_seen_at

## reactions
- id
- item_id
- type (keep | skip) — 사용자 반응 로그
- created_at

## Rule

- daily_feed 테이블 없음 — items.shown_date로 대체
- 관계 단순하게 유지
- 태그 없음
