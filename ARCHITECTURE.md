# Architecture

## Structure
`React (Vite)`  
→ `Cloudflare Worker (API + assets)`  
→ `D1`

## Runtime Flow
1. 사용자가 Feed 화면 진입
2. `GET /api/feed/today?date=...` 호출
3. Worker가 먼저 해당 날짜의 기존 슬롯을 조회
4. 이미 3개 슬롯이 있으면 즉시 반환(빠른 응답 경로)
5. 슬롯이 부족하면 source/items hydration + 날짜 슬롯 보충 수행
6. 중복 정리/약한 콘텐츠 보강/주기 refresh는 `ctx.waitUntil`로 백그라운드 처리
7. 카드 3개 + `hasNote` 상태만 반환
8. 메모는 별도 `GET /api/notes/:itemId`로 지연 조회

## Sources Flow
1. 사용자가 URL 여러 개를 한 번에 입력
2. `POST /api/sources` (bulk)
3. Worker에서 URL 정규화/중복 제거/host 단위 중복 처리
4. source 생성 후 item 시드 + 비동기 hydration
5. `GET /api/sources`에서 aggregate(`exposureCount`, `memoCount`, `lastActivityAt`) 반환

## Source Refresh Flow
1. 사용자가 My source 카드에서 `업데이트 확인` 버튼 클릭
2. `POST /api/sources/:id/refresh` 호출
3. Worker가 source 소유권/활성 상태 검증 후 수동 refresh 실행
4. `source_refresh_state.last_refreshed_at` 갱신
5. 과도한 부하 방지를 위해 source별 짧은 cooldown 적용

## Account/Auth Flow (Bootstrap)
1. 클라이언트(웹/익스텐션)가 Google ID Token 획득
2. `POST /api/auth/google`로 전달
3. Worker에서 Google JWKS 기반 ID token 검증
4. `users` / `auth_identities` upsert
5. Worker 세션 토큰 발급 + `sessions` 저장
6. 이후 `Authorization: Bearer <token>`로 `GET /api/auth/me` 호출

## User Scope
- `sources`/`items`는 원본 콘텐츠 저장소(공용 풀)
- 사용자별 상태/행동은 `user_sources`, `user_feed_slots`, `user_notes`, `user_reactions`에 저장
- API 응답은 모두 세션의 `user_id` 기준으로 계산

## API Surface
Read:
- `GET /api/feed/today`
- `GET /api/sources`
- `GET /api/thumbnail`
- `GET /api/notes/:itemId`
- `GET /api/auth/me`

Write:
- `POST /api/feed/replacement`
- `POST /api/reaction`
- `POST /api/sources`
- `POST /api/sources/:id/refresh`
- `PATCH /api/sources/:id`
- `DELETE /api/sources/:id`
- `POST /api/notes/:itemId`
- `DELETE /api/notes/:itemId`
- `POST /api/auth/google`
- `POST /api/auth/logout`

## Security Model
- `ADMIN_TOKEN`이 설정된 경우, 쓰기/민감 API는 토큰 필요.
- 피드 응답에서 메모 원문 미노출(`hasNote`만 반환).
- 썸네일 프록시는 사용자 소유 item URL에 한해 동작.
- 이미지 URL은 public `http/https`만 허용하고 사설망/localhost 요청 차단.

## Principle
백엔드는 최소 규칙과 데이터 무결성에 집중,  
경험/인터랙션은 프론트에서 빠르게 조정.
