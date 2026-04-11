# Architecture

## Structure

Web App (main)
  ↓
Cloudflare Worker (API + Cron)
  ↓
D1 Database

## Flow

1. Source 등록
2. Cron 실행 (daily)
   - 콘텐츠 수집
   - 중복 제거
   - DB 저장
   - 오늘의 3개 선정
3. 사용자 접속
4. /api/feed/today 호출
5. 카드 UI 렌더링
6. 스와이프 반응 저장

## API (MVP)

GET /api/feed/today  
POST /api/reaction  
GET /api/sources  
POST /api/sources  

## Cron

- 하루 1회 실행
- 역할:
  - 콘텐츠 수집
  - 셔플
  - 3개 선정

## Principle

백엔드는 단순하게  
프론트에서 경험 만든다
