# Tasks

## Phase 1 - Setup
- [x] Cloudflare project 생성
- [x] React + Vite 설정
- [x] D1 연결
- [x] wrangler 설정

## Phase 2 - UI
- [x] FeedCard 컴포넌트
- [x] 날짜별 카드 3개 레이아웃(반응형)
- [x] Feed/My 전환 UI
- [x] 날짜 이동 + TODAY
- [x] 메모 입력/수정/삭제 UI
- [x] My Sources 카드형 레이아웃

## Phase 3 - API
- [x] GET /api/feed/today
- [x] POST /api/feed/replacement
- [x] POST /api/reaction
- [x] GET /api/sources
- [x] POST /api/sources (bulk)
- [x] PATCH /api/sources/:id
- [x] DELETE /api/sources/:id
- [x] GET/POST/DELETE /api/notes/:itemId
- [x] GET /api/thumbnail

## Phase 4 - Data
- [x] D1 schema 적용 (sources/items/reactions/notes)
- [x] source level(core/focus/light) 반영
- [x] 날짜 슬롯(feed_slots) 운영 로직 반영

## Phase 5 - Cron
- [ ] scheduled() 구현 (보류)
- [ ] 주기 수집 안정화 (보류)

## Phase 6 - Polish
- [x] 기본 애니메이션/스켈레톤
- [x] 모바일 대응
- [x] 에러 토스트/재시도 UX
- [x] 보안 하드닝 1차 (메모 분리 조회, 썸네일 제한, 옵션 토큰)

## Phase 7 - Auth Bootstrap
- [x] 계정/세션 테이블 추가(users, auth_identities, sessions)
- [x] Google ID token 교환 API 골격(`/api/auth/google`)
- [x] 세션 조회/로그아웃 API 골격(`/api/auth/me`, `/api/auth/logout`)
- [x] 클라이언트 auth-session 유틸 추가
- [x] Chrome Extension 로그인 스캐폴딩(`extension/`)
- [x] Web 로그인 UI 연결(google id token)
- [x] 사용자별 데이터 스코프 분리(`user_*` 테이블)
- [x] AppToast 컴포넌트 분리 + app 유틸리티 분리 (api.ts, feed.ts, sources.ts)
- [x] 선택 날짜 sessionStorage 유지 (새로고침 후 복원)
- [x] My 뷰 source level 배지 + 토글 + 검색
- [x] 한국어 콘텐츠 우선 선택 (source fetch + 썸네일 크롤)
- [x] percent-encoded 제목 디코딩 (Medium %ED%85%8C → 테크)
- [x] 중복 source 방지 (host 기준) + 기존 host 매칭 시 hydration 유지
- [x] 크롤러 헤더 통합 + 불필요 헬퍼 제거
- [x] public GET /api/sources 엔드포인트 복구

## Rule

항상 작은 단위로 작업  
한 번에 하나만 구현
