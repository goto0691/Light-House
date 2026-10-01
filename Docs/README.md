# 🛟 Project Light House — Docs

> **2026-08-11 재기획 안내**: 아래 문서들은 기존 V1 제품의 기록이다. 자유 입력·멀티모달·동적 스키마·Gemini 이원화를 기준으로 하는 신규 개발은 [V2 Planning Index](./V2/README.md)에서 시작한다. V1 문서는 기존 구현과 데이터 출처를 이해하기 위한 legacy reference로 보존한다.
>
> 개인용 통합 정보 관리 웹 애플리케이션 (노션 MASTER DB 대체).
> 아래 V1 문서는 역사적 기획·기술 명세다. 현재 작업은 [루트 AGENTS.md](../AGENTS.md) → [현재 상태](./V2/CURRENT_WORK_STATE.md) → [V2 완료표](./V2/50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)에서 시작하고 필요한 계약만 찾아 읽는다.

---

## 🗂️ V1 문서 맵 (역사적 참조)

| # | 문서 | 한 줄 요약 | 주요 독자 |
|---|---|---|---|
| 00 | [MASTER_PLAN](./00_MASTER_PLAN.md) | 프로젝트 철학 + 기술 스택 + 고도화 포인트 | 모든 에이전트 |
| 01 | [INFORMATION_ARCHITECTURE](./01_INFORMATION_ARCHITECTURE.md) | 전체 IA, GNB/LNB, 라우팅 맵 | Frontend |
| 02 | [DESIGN_SYSTEM](./02_DESIGN_SYSTEM.md) | 디자인 토큰, Glassmorphism, 컴포넌트 카탈로그 | Frontend |
| 03 | [DATABASE_SCHEMA](./03_DATABASE_SCHEMA.md) | Drizzle 전체 스키마, 인덱스, FTS5, 트리거 | Backend |
| 04 | [API_SPECIFICATION](./04_API_SPECIFICATION.md) | Server Actions + Route Handlers 명세 | Backend |
| 05 | [PAGE_SPECIFICATIONS](./05_PAGE_SPECIFICATIONS.md) | 5대 도메인 모든 페이지의 UI/상호작용 | Frontend |
| 06 | [INTERACTION_PATTERNS](./06_INTERACTION_PATTERNS.md) | 멘션, Cmd+K, Quick Capture, Drawer, Cron | Frontend + Backend |
| 07 | [DEVELOPMENT_ROADMAP](./07_DEVELOPMENT_ROADMAP.md) | 7-Phase (10주) 개발 계획 + 에이전트 분담 | Orchestrator |

---

## 🎯 핵심 컨셉 (30초 브리핑)

- **5대 도메인**: 🏠 Dashboard / 🚀 Action Hub / 🧠 The Vault / 🤝 PRM / ⚙️ Life Ops
- **레이아웃**: 좌측 얇은 GNB(64px) + LNB(220px, 접힘) + Main Canvas (5가지 UI 모드)
- **기술**: Next.js 15 App Router + Cloudflare D1/R2/Vectorize + Drizzle + Tiptap + Tailwind v4 + Shadcn
- **철학**: Relation-First · Zero-Friction Capture · Progressive Disclosure · Glass-Calm Aesthetics

---

## 🚀 현재 작업 진입

최신 사용자 요청과 [V2 현재 상태](./V2/CURRENT_WORK_STATE.md)를 확인한다. V1 조사일 때만 아래 문서의 관련 부분을 참조한다. 이미 존재하는 저장소를 다시 초기화하거나 P0/I0부터 재구현하지 않는다.

작업 분담·검증은 [프로젝트 지침](../AGENTS.md), 전체 완성 범위·운영 gate는 [V2 완료표](./V2/50_COMPLETION_GOAL_AND_EXECUTION_PLAN.md)를 따른다. V1의 역할별 초기 지시와 출시 절차를 현재 명령으로 실행하지 않는다.

---

## 🧭 도메인별 Quick Jump

### 🚀 Action Hub (실행)
- 스키마: [03 §6](./03_DATABASE_SCHEMA.md#6--action-hub-스키마-schemaaction-hubts)
- API: [04 §5](./04_API_SPECIFICATION.md#5--action-hub-api)
- 페이지: [05 §2](./05_PAGE_SPECIFICATIONS.md#2--action-hub)

### 🧠 The Vault (지식)
- 스키마: [03 §7](./03_DATABASE_SCHEMA.md#7--vault-스키마-schemavaultts)
- API: [04 §6](./04_API_SPECIFICATION.md#6--vault-api)
- 페이지: [05 §3](./05_PAGE_SPECIFICATIONS.md#3--the-vault)

### 🤝 PRM (관계)
- 스키마: [03 §8](./03_DATABASE_SCHEMA.md#8--prm-스키마-schemaprmts)
- API: [04 §7](./04_API_SPECIFICATION.md#7--prm-api)
- 페이지: [05 §4](./05_PAGE_SPECIFICATIONS.md#4--prm)

### ⚙️ Life Ops (일상)
- 스키마: [03 §9](./03_DATABASE_SCHEMA.md#9-%EF%B8%8F-life-ops-스키마-schemalife-opsts)
- API: [04 §8](./04_API_SPECIFICATION.md#8-%EF%B8%8F-life-ops-api)
- 페이지: [05 §5](./05_PAGE_SPECIFICATIONS.md#5-%EF%B8%8F-life-ops)

### 🏠 Dashboard
- 페이지: [05 §1](./05_PAGE_SPECIFICATIONS.md#1--dashboard)
- 위젯 구성: Bento Grid 8종

---

## 📐 문서 편집 규칙

1. **권위 구분** — V1 `03`/`04`는 V1 명세다. V2는 관련 계약·현재 migration/registry/API 코드를 함께 확인한다. 역사적 문서가 현재 코드 또는 출시 상태의 증거는 아니다.
2. **의미 있는 변경 기록** — 계약·사용자 행동·운영 절차가 바뀌면 해당 문서를 갱신한다. 모든 사소한 코드 수정마다 새 기획 문서나 PR을 만들 필요는 없다.
3. **버전 주석** — 큰 변경 시 해당 문서 상단에 `v1.1 (YYYY-MM-DD)` 갱신.
4. **절대 링크 금지** — 모두 상대 경로 (`./0X_*.md`).

---

## ✅ Launch Criteria 요약

v1 런칭을 위해 충족해야 할 10가지 (상세: [`00 §6`](./00_MASTER_PLAN.md#6-성공-지표-launch-criteria))

- [ ] 5대 도메인 GNB 이동 및 기본 CRUD
- [ ] `@` / `[[` 양방향 동기화
- [ ] `Cmd+K` FTS5 < 100ms
- [ ] Quick Capture AI 정확도 > 80%
- [ ] Daily Log 3클릭 이하
- [ ] Hit-Them-Up Cron
- [ ] 노션 100% 이관
- [ ] LCP < 1.5s
- [ ] Dark + Light
- [ ] PWA 설치 가능

---

## 🏗️ 기획 고도화 내역 (v1.0)

**Senior Planner가 TOBE 원안에 추가 보강한 항목**:

1. **스키마 누락 복원**: 커리어&히스토리, 장소, 운동 로그, 묵상/일기 통합 필드
2. **인증 레이어**: Lucia Auth + `users`/`sessions` (단일 사용자여도 필수)
3. **풀텍스트 검색**: D1 FTS5 trigram 토크나이저 (한글 최적)
4. **의미 검색**: Cloudflare Vectorize + bge-m3 임베딩 (Zettel 전용)
5. **자동화 엔진**: 5개 Cron (Hit-Them-Up / 백업 / 주간리뷰 / 생일 / 하드삭제)
6. **AI 라우팅**: Claude Haiku 4.5 메인 + Workers AI Llama 3.3 fallback + Prompt caching
7. **이미지 파이프라인**: Cloudflare Images 변형 + R2 원본
8. **오프라인 전략**: PWA + IndexedDB + BackgroundSync Queue
9. **태그 정규화**: `tags` + `taggings` 다형성 (JSON 배열 폐기)
10. **감사 로그**: `audit_logs` + Soft Delete 90일 정책

자세한 내용은 [`00 §1`](./00_MASTER_PLAN.md#1-tobe에서-고도화한-포인트-as-a-senior-planner) 참조.

---

**🛟 Light House — 너의 두 번째 뇌에 불을 켜다.**
