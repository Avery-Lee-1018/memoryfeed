# Data Model

## WHAT
- 테이블/컬럼과 운영 규칙의 정본 문서.

## WHY
- 계정 스코프, 피드 고정성, 메모/반응 일관성을 DB 수준에서 보장하기 위해.

## HOW
- 스키마 변경은 이 문서와 `db/migrations`를 반드시 함께 업데이트한다.

## sources
- id
- name
- url
- type (rss | blog)
- level (core | focus | light)
- is_active

## items
- id
- source_id
- title
- url
- summary (nullable)
- thumbnail_url (nullable)
- status (active | archived)
- shown_date (legacy)
- snoozed_until (legacy)
- last_seen_at

## reactions
- id
- item_id
- type (keep | skip)
- created_at

## notes
- id
- item_id (UNIQUE)
- content
- updated_at

## feed_slots
- date
- slot_index (0, 1, 2)
- item_id
- source_id
- created_at
- PK: (date, slot_index)
- UNIQUE: (date, item_id)

## user_sources
- user_id
- source_id
- is_active
- level (core | focus | light)
- created_at
- PK: (user_id, source_id)

## user_feed_slots
- user_id
- date
- slot_index (0, 1, 2)
- item_id
- source_id
- created_at
- PK: (user_id, date, slot_index)
- UNIQUE: (user_id, date, item_id)

## user_notes
- id
- user_id
- item_id
- content
- updated_at
- UNIQUE: (user_id, item_id)

## user_reactions
- id
- user_id
- item_id
- type (keep | skip)
- created_at

## source_refresh_state
- source_id (PK)
- last_refreshed_at

## users
- id
- email (UNIQUE)
- display_name
- avatar_url
- created_at
- last_login_at

## auth_identities
- id
- user_id
- provider (`google`)
- provider_sub (provider 사용자 고유값)
- client_id
- email
- email_verified
- created_at
- last_used_at
- UNIQUE(provider, provider_sub)

## sessions
- id (session id)
- user_id
- issued_at
- expires_at
- revoked_at
- user_agent
- ip_hint

## Rules
- 한 날짜 피드는 `feed_slots` 기준 3개.
- 메모 본문은 피드 응답에 포함하지 않음 (`hasNote`만 전달).
- source 삭제 시 연관 items/notes/reactions/feed_slots는 FK로 정리됨.
- source 단위 통계는 조회 시 aggregate 계산.
- source별 수동 갱신 시각은 `source_refresh_state`로 추적.
- 인증은 `users` + `auth_identities` + `sessions`.
- 피드/메모/반응/소스 상태는 `user_*` 테이블로 계정별 분리.
