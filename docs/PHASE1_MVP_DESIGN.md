# PAChecker Phase 1 MVP 설계

## 설계 원칙

- 개인용 웹앱을 우선하며 PC와 iPhone은 동일한 서버 데이터를 사용합니다.
- 수행평가 CRUD와 날짜 관리는 AI 기능과 독립적으로 동작해야 합니다.
- 핵심 데이터는 고정 스키마, 수행평가별 부가 정보는 `extra_fields`로 처리합니다.
- AI 분석 결과는 초안으로만 제공하고 사용자 검토 후에만 확정 저장합니다.
- 원본 수행평가지 이미지는 보존합니다.
- AI 호출 자격 증명은 서버 측에만 둡니다.
- PWA는 향후 확장 가능성을 유지하되 Phase 1에서는 구현하지 않습니다.

## MVP 사용자 흐름

### 직접 등록

1. 대시보드 또는 목록에서 새 수행평가 등록을 시작합니다.
2. 과목, 제목, 날짜, 설명, 준비물, 상태를 입력합니다.
3. 필요한 부가 정보를 `extra_fields`에 추가합니다.
4. 알림 시점을 설정하고 저장합니다.
5. 목록/상세에서 D-Day와 상태를 확인합니다.

### 이미지 기반 AI 등록

1. 사용자가 수행평가지 이미지를 업로드합니다.
2. 서버가 원본 이미지를 보존하고 AI 분석을 요청합니다.
3. AI가 고정 핵심 필드와 `extra_fields` 후보를 구조화합니다.
4. 웹앱이 결과를 등록 초안으로 표시합니다.
5. 사용자가 원본 이미지와 결과를 비교해 수정합니다.
6. 사용자가 확정한 경우에만 수행평가 레코드를 생성합니다.
7. AI 분석 실패 시 직접 등록 기능은 그대로 사용할 수 있습니다.

### 조회 및 관리

1. 대시보드/목록에서 예정 수행평가와 D-Day를 확인합니다.
2. 상세 화면에서 내용, 준비물, 부가 정보, 알림, 원본 이미지를 확인합니다.
3. 수정 시 데이터를 편집하고 저장합니다.
4. 날짜 변경 시 D-Day를 새 날짜 기준으로 계산하며 향후 알림 예약도 새 날짜에 맞춰 갱신해야 합니다.
5. 완료 상태 변경과 삭제를 수행할 수 있습니다.

### 과목 관리

1. 과목을 추가/수정/조회합니다.
2. 수행평가 생성 시 등록된 과목을 선택합니다.
3. 연결된 수행평가가 있는 과목의 삭제 정책은 구현 전에 별도 확정합니다.

## 핵심 화면과 주요 행동

### 대시보드
- 임박한 수행평가 및 D-Day 확인
- 상세 이동
- 직접 등록 시작
- 이미지 기반 등록 시작

### 수행평가 목록
- 전체 목록 조회
- 과목/상태/날짜 기준 필터 또는 정렬
- 상세 이동
- 신규 등록

### 수행평가 등록/수정
- 과목, 제목, 날짜, 설명, 준비물, 상태 입력/수정
- 알림 시점 설정
- `extra_fields` 추가/수정/삭제
- 저장/취소

### 수행평가 상세
- 핵심 정보와 D-Day 확인
- `extra_fields`, 알림, 원본 이미지 확인
- 수정, 완료 처리, 삭제

### 이미지 업로드
- 이미지 선택 또는 촬영 결과 업로드
- 미리보기
- 분석 요청
- 실패 시 재시도 또는 직접 등록 전환

### AI 등록 초안 검토
- 원본 이미지 확인
- 핵심 필드와 `extra_fields` 검토/수정
- 누락 정보 추가
- 확정 저장 또는 초안 폐기

### 과목 관리
- 과목 목록 조회
- 추가/수정/삭제 요청

## 데이터 모델과 관계

### `subjects`
- `id`
- `name`
- `created_at`
- `updated_at`

관계: `subjects 1 : N assessments`

### `assessments`
- `id`
- `subject_id`
- `title`
- `assessment_date`
- `description`
- `materials`
- `status`
- `extra_fields`
- `created_at`
- `updated_at`

`extra_fields`는 평가 기준, 배점, 발표 시간, 제출 형식 등 수행평가별 부가 정보만 저장합니다.

### `notification_settings`
- `id`
- `assessment_id`
- `offset_days`
- `enabled`
- `created_at`
- `updated_at`

관계: `assessments 1 : N notification_settings`

### `source_images`
- `id`
- `assessment_id` (초안 단계에서는 `NULL` 허용 후보)
- `storage_key`
- `original_filename`
- `mime_type`
- `created_at`

관계: `assessments 1 : N source_images`를 추천합니다.

### `ai_drafts`
- `id`
- `source_image_id`
- `extracted_core`
- `extracted_extra_fields`
- `status`
- `error_message`
- `created_at`
- `updated_at`

관계: `source_images 1 : N ai_drafts`를 허용하면 동일 원본 재분석을 표현할 수 있습니다. 확정 시 `assessments`를 생성하고 관련 원본 이미지를 연결합니다.

## 데이터베이스 논리 스키마 초안

```text
subjects
- id PK
- name NOT NULL
- created_at NOT NULL
- updated_at NOT NULL

assessments
- id PK
- subject_id FK -> subjects.id NOT NULL
- title NOT NULL
- assessment_date NOT NULL
- description NULL
- materials NULL
- status NOT NULL
- extra_fields NOT NULL DEFAULT empty-object
- created_at NOT NULL
- updated_at NOT NULL

notification_settings
- id PK
- assessment_id FK -> assessments.id NOT NULL
- offset_days NOT NULL
- enabled NOT NULL DEFAULT true
- created_at NOT NULL
- updated_at NOT NULL

source_images
- id PK
- assessment_id FK -> assessments.id NULL
- storage_key NOT NULL
- original_filename NULL
- mime_type NULL
- created_at NOT NULL

ai_drafts
- id PK
- source_image_id FK -> source_images.id NOT NULL
- extracted_core NOT NULL
- extracted_extra_fields NOT NULL
- status NOT NULL
- error_message NULL
- created_at NOT NULL
- updated_at NOT NULL
```

무결성 원칙:
- AI가 추출한 날짜 등 핵심 값은 검토 후에만 `assessments`에 저장합니다.
- `extra_fields`는 핵심 필드의 대체 저장소로 사용하지 않습니다.
- 알림 채널, 삭제 정책, AI 초안 보존 기간은 아직 확정하지 않습니다.

## 기술 스택 후보 비교

### 확정안: Next.js 단일 풀스택 웹 프로젝트 + MariaDB

후보 구성:
- 웹 UI 및 서버: Next.js
- 언어: TypeScript
- DB: MariaDB
- 이미지: 서버에서 접근 가능한 파일/오브젝트 저장소
- AI: 서버 측 계층에서 CLIProxyAPI 호출

장점:
- 반응형 웹 UI와 서버 API를 한 프로젝트에서 관리하기 쉽습니다.
- 서버 측 AI 호출과 비밀 정보 분리가 자연스럽습니다.
- 향후 PWA 확장 경로를 유지할 수 있습니다.
- 개인용 프로젝트에서 프론트/백엔드를 과도하게 분리하지 않아도 됩니다.
- 관계형 필드와 JSON 형태의 `extra_fields`를 함께 다루기 좋습니다.

주의점:
- 실제 배포 방식과 MariaDB 호스팅은 별도 결정이 필요합니다.
- Web Push를 선택할 경우 iPhone/PWA 동작 조건을 실제로 검증해야 합니다.

### 대안 A: React/Vite + 별도 백엔드 API

장점:
- 프론트엔드와 백엔드 책임을 명확히 분리할 수 있습니다.
- 백엔드 기술 선택 자유도가 높습니다.

단점:
- 개인용 MVP에서는 배포와 유지보수 복잡도가 증가할 수 있습니다.
- 인증, CORS 등 별도 경계가 추가됩니다.

### 대안 B: 경량 서버 프레임워크 + 서버 렌더링 중심 웹앱

예: Flask/FastAPI 계열 + 단순 웹 UI.

장점:
- 서버 중심 기능과 AI 호출을 단순하게 구성하기 좋습니다.
- 작은 개인용 서비스에 적합할 수 있습니다.

단점:
- 모바일 UX와 PWA 기능을 확장할수록 프론트엔드 구성이 추가로 필요할 수 있습니다.

### DB 방향

브라우저 로컬 저장소만을 정본으로 두지 않고, PC/iPhone이 공통으로 접근하는 서버 관계형 DB를 정본으로 두는 방향을 추천합니다.

- MariaDB를 서버의 정본 관계형 DB로 사용합니다.
- `extra_fields`는 JSON 형태로 저장하는 방향을 유지하며, 구체적인 SQL 타입과 검증 방식은 DB 구현 단계에서 확정합니다.
- 브라우저 로컬 저장소나 SQLite를 정본 DB로 사용하지 않습니다.

### 이미지 저장 방향

추천: DB에는 `storage_key`와 메타데이터를 두고 이미지 파일은 별도 저장소에 보관합니다.

대안:
- 단일 서버의 영속 파일 시스템
- 오브젝트 스토리지

최종 선택은 배포 환경, 백업, 접근 제어, 비용을 확인한 뒤 결정합니다.

### 알림 방향

Phase 1에서는 최종 제공자를 확정하지 않습니다.

후보:
- Web Push/PWA 알림
- 캘린더 연동
- 별도 메시징/알림 서비스

## 확정된 설계

- 웹앱 기반으로 PC/iPhone이 동일한 서버 데이터를 사용합니다.
- 웹 프레임워크는 Next.js, 언어는 TypeScript, 정본 DB는 MariaDB로 확정했습니다.
- CRUD가 AI 기능과 독립적으로 동작합니다.
- `subjects`, `assessments`, `notification_settings`를 핵심 관계형 모델로 둡니다.
- `source_images`, `ai_drafts`를 통해 원본 보존과 AI 초안 검토 흐름을 분리합니다.
- 핵심 정보는 고정 필드, 부가 정보는 `extra_fields`에 저장합니다.
- 한 수행평가에 여러 알림 시점을 둘 수 있는 구조를 사용합니다.

## 후속 단계에서 확정된 사항

2026-09-20 기준 Phase 1 이후 다음 결정이 확정·구현되었습니다.

- MariaDB 접근은 `mysql2` promise API 기반 서버 전용 계층을 사용합니다.
- 프로덕션 DB는 MariaDB Cloud Serverless Free를 사용하고, Vercel에서는 Cloudflare Worker/Hyperdrive bridge를 경유합니다.
- 원본 이미지 production 저장소는 private Vercel Blob입니다.
- 초기 알림은 수행평가 날짜와 `offset_days`를 이용한 당일 인앱 알림으로 구현했습니다.
- CLIProxyAPI는 Oracle Cloud Always Free VM에서 systemd + Caddy HTTPS 구성으로 실행합니다.
- 연결된 수행평가가 있는 과목은 외래키 제약 때문에 그대로 삭제되지 않습니다.
- 미확정 AI 초안은 사용자가 폐기할 수 있고, 다른 초안이나 수행평가에 연결되지 않은 원본 이미지는 함께 정리합니다. 확정 초안은 읽기 전용으로 유지하며 자동 보존 기간 정책은 아직 두지 않았습니다.

## 현재 후속 작업

Phase 1-6은 완료됐으며 Phase 7 배포를 진행 중입니다. 남은 핵심 작업은 MariaDB Cloud 원격 connection string으로 Hyperdrive를 생성하고 Worker를 배포한 뒤 Vercel DB bridge 환경 변수를 등록하여 DB CRUD·이미지·AI 흐름을 외부 end-to-end로 검증하는 것입니다.
