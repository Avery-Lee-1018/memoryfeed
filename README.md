# memoryfeed
기억해둔 콘텐츠를 날짜별로 다시 꺼내보는 개인 MVP.

## 현재 웹 구조 (기준: main)
- 상단: 날짜 표시 + 좌/우 이동 + `TODAY` 복귀
- 타이틀: 날짜별 고정 문장(연속 중복 방지)
- 본문: 3개 카드 레이아웃(모바일 1열, 태블릿 2열, 데스크톱 3열)
- 카드 액션:
  - `오늘은 안볼래요`로 대체 콘텐츠 호출
  - `메모` 저장/수정/삭제
  - 메모 저장 시 카드가 좌측 우선 정렬
- 배경 SVG 스탬프:
  - 메모 있는 날짜에서만 노출
  - 날짜별 고정 셔플(종류/위치/크기/레이어)
  - 안전영역 기반 배치

## Tech Stack
- Frontend: React + Vite + TypeScript
- Backend: Cloudflare Workers
- DB: Cloudflare D1 (binding: `DB`)
- Deploy: Wrangler

## API (현재 사용)
- `GET /api/feed/today?date=YYYY-MM-DD`
- `POST /api/feed/replacement`
- `POST /api/reaction`
- `GET /api/sources`
- `POST /api/notes/:id`
- `DELETE /api/notes/:id`
- `GET /api/thumbnail`

## 로컬 실행
```bash
npm install
npx wrangler login
npx wrangler d1 create memory_feed
```

`wrangler.jsonc`의 `d1_databases[0].database_id`에 생성된 ID 반영 후:

```bash
npm run d1:migrate:local
npm run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- Worker/API: [http://localhost:8787](http://localhost:8787)

## 배포
```bash
npm run deploy
```

현재 프로덕션 URL:
- [https://memoryfeed.yssv6273.workers.dev](https://memoryfeed.yssv6273.workers.dev)

## 자동 동기화 워크플로
`main` 푸시 시 `.github/workflows/sync-to-org.yml`이 실행되어 Org 저장소로 미러 푸시합니다.
