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

날짜 회귀 테스트 15건, lint, TypeScript, 프로덕션 빌드 통과.
iPhone 이미지 선택 메뉴 정상 동작은 사용자가 확인했습니다.
다음 항목은 완료로 표시하지 않습니다:
- 최신 인증 모델 목록 직접 조회: 환경 변수 내보내기 값이 마스킹됨.
- 삭제한 테스트 초안의 원본 Blob 객체 부재: 객체 키 기반 증거 미확보.
- 날짜 수정 후 실제 이미지 재시험 및 PC/iPhone 동기화·홈 화면 PWA 설치 확인.

실제 수행평가 이미지와 운영 데이터는 저장소에 올리지 않습니다.
