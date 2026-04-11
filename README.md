# memoryfeed
A minimal feed that resurfaces what you saved, so it actually gets remembered.

# Memory Feed Docs + MVP Skeleton

Phase 1 목표: Cloudflare Workers + React + Vite + D1 최소 실행 뼈대.

## 1) 설치

```bash
npm install
```

## 2) D1 생성 및 설정

```bash
npx wrangler d1 create memory_feed
```

생성 결과의 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 반영.

## 3) 마이그레이션

로컬 D1:

```bash
npm run d1:migrate:local
```

원격 D1:

```bash
npm run d1:migrate:remote
```

## 4) 개발 실행

```bash
npm run dev
```

- Web (Vite): http://localhost:5173
- Worker API (Wrangler): http://localhost:8787

## 5) 배포

```bash
npm run deploy
```

배포 전 Cloudflare 로그인 필요:

```bash
npx wrangler login
```
