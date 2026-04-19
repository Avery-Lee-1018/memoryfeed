# CLAUDE.md

## WHAT
- 이 저장소는 `memoryfeed` MVP(React + Worker + D1) 운영 문서/코드 베이스다.
- 목표는 “저장한 링크를 날짜별로 다시 떠오르게 하는 경험”을 빠르게 실험/개선하는 것.

## WHY
- 문서는 의사결정 속도를 높이고, 기능 추가 시 UX/안정성 회귀를 줄이기 위해 존재한다.
- 과설계를 피하고, 작은 개선을 빠르게 배포하기 위해 핵심 원칙을 먼저 고정한다.

## HOW
- 신규 기능/수정 시 아래 순서로 문서를 확인한다.
  1. [PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md)
  2. [MVP_SCOPE.md](./MVP_SCOPE.md)
  3. [DESIGN_UX_PRINCIPLES.md](./DESIGN_UX_PRINCIPLES.md)
  4. [ARCHITECTURE.md](./ARCHITECTURE.md)
  5. [DATA_MODEL.md](./DATA_MODEL.md)
  6. [TASKS.md](./TASKS.md)
- 규칙:
  - 한 번에 하나의 문제만 수정한다.
  - 사용자 체감 결과가 없는 변경은 피한다.
  - 액션 후 상태는 반드시 명확해야 한다(성공/실패/피드아웃).

## Progressive Disclosure
- 상위 문서는 “요약/의사결정” 중심으로 짧게 유지한다.
- 상세 절차/연구는 별도 문서로 분리한다.
  - 인증 연구: [AUTH_RESEARCH.md](./AUTH_RESEARCH.md)
  - 일일 변경 리포트: [REPORT_2026-04-19.md](./REPORT_2026-04-19.md)

## Doc 운영 기준
- 권장 길이:
  - 상위 가이드 문서: 60~200줄
  - 실행/레퍼런스 문서: 필요 시 확장 가능
- 중복 작성 금지:
  - 같은 내용은 한 문서에만 “정본(source of truth)”로 유지하고, 나머지는 링크로 참조.
