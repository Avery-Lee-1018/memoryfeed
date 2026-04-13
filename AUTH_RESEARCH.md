# Auth Research (Chrome Extension + Web)

작성일: 2026-04-13 (KST)

## 목표
- Google 계정으로 로그인
- Chrome Extension + Web에서 공통 계정 사용
- 비용은 낮추고, 보안은 MVP 기준 이상으로 확보

## 결론 (권장안)
`Google Identity (OIDC) + Cloudflare Worker 세션 + D1 사용자 테이블`

- 소셜 로그인 공급자: Google만 우선 지원
- 인증 검증: Worker에서 Google ID Token 서명/JWT 검증
- 세션 저장: D1 `sessions` 테이블
- API 인증: `Authorization: Bearer <session_token>`

이 방식은 Firebase/Auth0 같은 별도 Auth SaaS 없이도 운영 가능해서 고정비를 줄이기 쉽고, 기존 Worker + D1 스택과 일관성이 높다.

## 왜 이 방식이 효율적인가
1. 운영 단순성
- 지금 스택(Worker + D1)에서 끝난다.
- 사용자/세션/권한을 같은 DB에서 관리 가능.

2. 비용 절감
- 추가 Auth SaaS 비용 없이 시작 가능.
- D1은 rows read/write 기반 과금이라, 인덱스/짧은 세션 조회 쿼리로 최적화 가능.

3. 보안 통제
- 토큰 검증 조건(issuer/audience/exp/email_verified)을 서버에서 강제 가능.
- 세션 폐기(logout/revoke), 만료 정책을 서버에서 제어 가능.

## 보안 체크리스트 (MVP 최소)
- ID Token 검증 시:
  - issuer 검증
  - audience(허용 client id) 검증
  - exp 만료 검증
  - email_verified 검증
- 세션:
  - 짧은 만료(예: 30일, 추후 단축 가능)
  - 서버 세션 revoke 지원
  - 로그아웃 시 세션 폐기
- 비밀키:
  - `AUTH_JWT_SECRET`은 반드시 Wrangler Secret으로 저장
  - 클라이언트 코드에 비밀값 하드코딩 금지
- 전송:
  - HTTPS only
  - 민감 API는 Authorization 헤더 필수

## 구현 옵션 비교 (요약)
1. Worker + D1 직접 인증 (권장)
- 장점: 비용/제어/스택 일관성
- 단점: 직접 구현 책임 증가

2. Firebase Auth
- 장점: 빠른 도입, SDK 성숙
- 단점: 의존성/벤더 고착, 구조 분산

3. Cloudflare Access 사용자 로그인
- 장점: 강한 perimeter 보안
- 단점: 앱 내 사용자 계정 모델/제품 UX와는 목적이 다름

## 참고 문서
- Chrome Extensions OAuth (Chrome Extension client type):  
  https://developer.chrome.com/docs/extensions/how-to/integrate/oauth
- Google OpenID Connect / ID token claims:  
  https://developers.google.com/identity/openid-connect/openid-connect
- Cloudflare D1 pricing / rows_read, rows_written:  
  https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Access JWT validation (참고):  
  https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
