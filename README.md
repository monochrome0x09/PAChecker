# PAChecker

개인용 수행평가 관리 웹앱. Next.js·TypeScript, MariaDB, 이미지 AI 초안 검토, D-Day 알림, PWA를 제공합니다.

## 실행

Node.js 22 이상을 사용하세요.

```sh
npm ci
cp .env.example .env.local
# .env.local에 본인의 서버 설정을 입력
npm run dev
```

`database/001_initial_schema.sql`, `database/002_phase3_notification_constraints.sql` 순서로 DB 스키마를 적용합니다.
프로덕션은 웹/API 서버, Worker/Hyperdrive DB bridge, MariaDB, private Blob, HTTPS AI endpoint를 분리합니다.
`wrangler.toml`의 Hyperdrive ID는 본인 값으로 바꾸고 bridge bearer token은 secret으로 등록하세요.
`DB_BRIDGE_TOKEN`과 개인 로그인 암호 등은 서버 환경 변수에만 저장합니다.

## 검증

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

AI 추출값은 사용자가 검토·확정한 후에만 수행평가로 저장됩니다.
날짜가 모호하면 직접 입력해야 합니다. 연도가 생략된 날짜는 현재 한국 연도로 제안되므로 반드시 원본과 비교하세요.

## 보안과 배포

이 저장소는 운영 작업 디렉터리에서 만든 정제본입니다. 운영 환경 파일, 인증 자료, 실제 업로드 이미지, 배포 연결 정보 및 기존 Git 이력은 포함하지 않습니다.
`.env.example`은 예시이며 실제 자격 증명을 커밋하지 마세요.
외부 서비스의 무료 한도와 초과 과금 조건은 각 계정에서 확인해야 합니다.

## 현재 검증 상태

날짜 회귀 테스트 15건, lint, TypeScript, 프로덕션 빌드를 통과했습니다.
iPhone 이미지 선택 메뉴, 실제 수행평가 이미지 재시험, PC/iPhone 동일 데이터 동기화와 PWA 동작을 사용자 실기기에서 확인했습니다.
삭제한 테스트 초안의 가상 PNG 원본 Blob 부재를 확인했고, 프로덕션 서버 환경의 인증된 모델 목록 요청은 HTTP 200과 모델 11개로 확인했습니다.
Phase 7 필수 운영 검증을 완료했으며, 과거 HTTPS 502는 현재 재현되지 않지만 원인은 미확정 상태로 기록합니다.

실제 수행평가 이미지와 운영 데이터는 저장소에 올리지 않습니다.
