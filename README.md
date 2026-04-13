# memoryfeed
기억해둔 링크를 날짜별 피드(3장)로 다시 꺼내보는 개인 MVP.

## 현재 상태 (main 기준)
- Feed / My 2개 뷰
- 날짜 이동(`←`, `→`, `TODAY`) + 날짜별 고정 헤드라인
- 날짜별 3카드 피드 + `오늘은 안볼래요` 대체 호출(오늘 날짜만)
- 메모 저장/수정/삭제
- Source 벌크 등록(공백/줄바꿈 분리, 중복/실패 피드백)
- My에서 source 레벨(core/focus/light), 토글, 삭제, 검색

## Stack
- Frontend: React + Vite + TypeScript
- Backend: Cloudflare Workers
- DB: Cloudflare D1 (`DB` binding)
- Deploy: Wrangler

## API
Public:
- `POST /api/auth/google` (Google ID token 교환)
- `GET /api/auth/me`
- `POST /api/auth/logout`

User-scoped (Bearer session token required):
- `GET /api/feed/today?date=YYYY-MM-DD`
- `POST /api/feed/replacement`
- `POST /api/reaction`
- `GET /api/sources`
- `POST /api/sources`
- `PATCH /api/sources/:id`
- `DELETE /api/sources/:id`
- `GET /api/thumbnail?pageUrl=...&imageUrl=...`
- `GET /api/notes/:itemId`
- `POST /api/notes/:itemId`
- `DELETE /api/notes/:itemId`

## Local Dev
```bash
npm install
npx wrangler login
npm run d1:migrate:local
npm run dev
```

- Vite: [http://localhost:5173](http://localhost:5173)
- Worker: [http://localhost:8787](http://localhost:8787)

포트는 환경에 따라 달라질 수 있으므로, 실제 실행 URL은 터미널 출력 기준으로 확인.

## Chrome Extension Auth (초석)
`extension/` 폴더에 MV3 익스텐션 로그인 브릿지가 포함되어 있습니다.

### 1) Google OAuth Client 생성
Chrome 공식 가이드 기준으로 OAuth Client를 `Chrome Extension` 타입으로 생성:
- https://developer.chrome.com/docs/extensions/how-to/integrate/oauth

설정 시 필요:
- Extension ID (로드 후 확인 가능)
- 생성된 `Client ID`

웹 로그인도 함께 쓸 경우 `Web application` 타입 Client ID도 추가로 생성해 두세요.

### 2) Extension 설정값 입력
`extension/config.js`에서 값 수정:
```js
export const AUTH_CONFIG = {
  googleClientId: "YOUR_CHROME_EXTENSION_CLIENT_ID",
  apiBaseUrl: "https://memoryfeed.yssv6273.workers.dev",
};
```

### 3) Worker Auth 변수 설정
```bash
npx wrangler secret put AUTH_JWT_SECRET
npx wrangler secret put GOOGLE_CLIENT_IDS
```

- `AUTH_JWT_SECRET`: 세션 서명용 랜덤 문자열
- `GOOGLE_CLIENT_IDS`: 허용할 Google client id 목록 (쉼표 구분)
  - 예: `web-client-id.apps.googleusercontent.com,chrome-extension-client-id.apps.googleusercontent.com`
- 선택: `EXTENSION_ORIGINS` 환경변수에 허용할 특정 origin 추가 가능

### 4) Extension 로드
- Chrome `chrome://extensions`
- Developer mode ON
- `Load unpacked` → `extension/` 폴더 선택

### 5) 테스트
- 익스텐션 팝업에서 `Google로 로그인`
- 성공 시 `/api/auth/google`로 교환 후 세션 저장
- 이후 `me/logout` 호출 가능

## Deploy
```bash
npm run d1:migrate:remote
npm run deploy
```

Production:
- [https://memoryfeed.yssv6273.workers.dev](https://memoryfeed.yssv6273.workers.dev)

## Security Notes
- 메모 본문은 피드 응답에 포함하지 않음(`hasNote`만 노출).
- 썸네일 프록시는 로그인 사용자 본인 source 도메인 계열 URL만 허용.
- API는 사용자 세션(`Bearer`) 기준으로 동작.
- 계정 연동 필수 변수:
  - `AUTH_JWT_SECRET` (필수, Wrangler Secret)
  - `GOOGLE_CLIENT_IDS` (필수, 쉼표 구분)
  - `EXTENSION_ORIGINS` (선택, 추가 CORS origin whitelist)

## GitHub Actions
- `.github/workflows/sync-to-org.yml`: `main` push 시 org 저장소로 미러 push.
