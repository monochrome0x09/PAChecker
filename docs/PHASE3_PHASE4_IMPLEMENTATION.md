# PAChecker Phase 3-4 구현 결정

## Phase 3 날짜 및 알림

- D-Day는 브라우저의 현재 로컬 날짜와 수행평가의 달력 날짜를 자정 기준으로 비교합니다.
- 알림 설정은 절대 실행 시각이 아닌 수행평가 날짜 기준 `offset_days`로 저장합니다.
- 초기 알림 전달 방식은 개인용 MVP에 맞춘 대시보드 인앱 알림입니다.
- 알림 조회 시 `assessment_date - offset_days = 조회 날짜` 조건으로 계산하므로 수행평가 날짜가 변경되어도 별도 예약 레코드를 갱신할 필요가 없습니다.
- 완료된 수행평가는 당일 알림 대상에서 제외합니다.
- 외부 푸시 제공자와 백그라운드 전달은 후속 확장 결정으로 유지합니다.

## Phase 4 이미지 기반 AI 등록

- Phase 4 최초 구현에서는 원본 이미지를 서버 로컬 파일 저장소에 UUID 기반 키로 보존하고 `source_images`에 저장 키와 파일 메타데이터를 기록했습니다. Phase 7에서 저장 계층을 공통 provider 경계로 분리했으며 production은 private Vercel Blob을 사용하고 Vercel에서 local provider 사용을 차단합니다.
- 허용 형식과 최대 크기는 업로드 API에서 검증합니다.
- AI 호출은 서버 전용 환경 변수로 설정한 CLIProxyAPI 호환 HTTP 엔드포인트를 사용합니다.
- 모델에는 고정 핵심 필드와 `extra_fields`를 분리한 JSON 구조화 결과를 요청합니다.
- 분석 결과는 `ai_drafts`에 먼저 저장되며 이 단계에서는 `assessments` 레코드를 만들지 않습니다.
- 사용자는 원본과 분석 결과를 나란히 확인하고 핵심 필드 및 추가 정보를 수정합니다.
- 명시적인 확정 요청에서만 수행평가를 생성하고 원본 이미지를 연결합니다.
- AI 분석 실패는 초안 오류로 표시하며 기존 직접 등록 및 CRUD 경로와 분리합니다.

## 환경 변수

- MariaDB: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- CLIProxyAPI: 구현 어댑터가 사용하는 서버 전용 URL, 인증 토큰, 모델 이름
- 이미지 저장소: 서버 로컬 저장 루트

실제 값은 저장소에 기록하지 않으며 배포 환경에서 설정합니다.

## 검증 경계

정적 타입 검사, ESLint, 프로덕션 빌드와 내부 구조 검증을 수행합니다. 2026-09-20 기준 MariaDB Cloud TLS·스키마·`002` 연속 재적용, Worker/Hyperdrive를 경유하는 Vercel DB CRUD, 이미지 Blob 업로드/재조회는 완료됐습니다. Oracle VM CLIProxyAPI의 공개 HTTPS는 현재 502이며, 월 0원 목표로 기존 VM의 Caddy 경로 복구와 실제 멀티모달 AI 등록 end-to-end 검증이 남아 있습니다.
