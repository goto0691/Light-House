# G06 · 이관 정리본·삭제 증분과 참조 ID 충돌 복원

작성: 2026-09-12. [59번](./59_PROMPT_CURATION_API_PORTABILITY.md)의 API 이동성 시험을 실제 snapshot 이관과 base-present 삭제로 확장한다. 이번 검사는 최종 종료했으며 전체 goal과 원격 운영 승인은 별개다. 최종 결과는 아래, 다음 작업은 [현재 상태](./CURRENT_WORK_STATE.md)를 따른다.

## 이번 계약과 오케스트레이션

- root: 실제 SQLite 경계 시험, 복원 제품 코드, 통합 실행 창과 완료표.
- exact_ai_evidence_review: 기존 API portability 시험 한 파일 확장. full 이전 독립 삭제 대상 T, 실제 S2/migration, 세 tombstone, 46테이블 ZIP 비교, fresh/repeat.
- curation_evidence_client_review: 독립 읽기 검토 후 V2 ID 별칭 충돌의 SQLite 재현 시험 한 파일. 제품 수정 권한 없음.
- migration_recovery_browser: 다음 G07 검색·정확 출처 이동의 현재 코드 읽기 인계. 이번 G06 검증과 분리한다.

Cloudflare/Wrangler 지침에 따라 설치 Wrangler4.121.0 타입과 [공식 API](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)를 확인했다. 긴 검사는 기존 격리 config와 `persist:false`, `remoteBindings:false`, `envFiles:[]`를 사용한다. 실제 원격 DB/R2·환경 파일·Gemini·Next 서버·배포·원격 migration은 변경하지 않는다. 시험용 격리 DB에만 기존 migration을 적용했다. 종료 시 proxy dispose와 잔여 workerd를 확인한다.

## 재현한 ID 재매핑 결함

정상 원본 A의 ID가 복원 대상의 B라는 ID로 재사용되고, 들어오는 다른 정리본 B는 ID 충돌로 F에 저장될 수 있다. 원본 참조 A→대상 B를 처리한 뒤 B→F를 다시 적용하면 잘못된 근거 또는 자기 참조가 된다. ID 매핑은 연쇄 별칭 해석이 아니라 **원본 namespace에서 대상 namespace로 한 번 적용**해야 한다.

V1 `restore-bundle-v1.ts`는 resolve 단계의 candidate에 finalRows/insert 단계에서 다시 FK 변환을 적용했다. 실제 SQLite source A(S1)→migrated B(S2), target에는 같은 논리 A를 incoming B ID로 보관한 사례가 dry-run fork1/conflict0 뒤 self-reference cycle로 중단되었다. 원문 오염으로 단정하지 않고 정상 복원 차단 결함으로 판정한다.

root는 최종 변환에 원래 exported row의 FK를 사용하고, 이미 선택한 target primary ID·정화된 job 상태·업로드 object key는 유지하도록 수정했다. 변환 완료한 candidate를 insert에서 다시 변환하지 않는다. V2는 필요한 FK의 mapping만 로드하므로 단순 A/B만으로 같은 실패를 주장하지 않으며 두 self FK가 함께 있는 실제 undo 경계를 별도 재현한다.

## 검사 이력 · 최종 종료

| 시각/범위 | 결과 | 의미/한계 |
| --- | --- | --- |
| 17:56 SQLite 신규6 | 6 PASS, exit0,3.59초 | 실제 source/migration, owner/document/missing/self, foreign PK 충돌과 반복 복원. 아직 ID alias overlap 없음 |
| 17:57 alias RED | 6 PASS/1 FAIL, exit1,4.18초 | 기존 ID와 incoming ID의 겹침에서 `reference_closure_invalid`, self-reference cycle |
| 17:57 V1 수정 후 결합 | 14 PASS, exit0,5.24초 | 신규7+기존 identity4+canonical3. Node SQLite이며 ZIP/workerd 아님 |
| 18:00 후속 신규7 | 7 PASS, exit0,4.24초 | owner/document 공격을 migrated row에 직접 검증하여 우연한 선행 오류로 통과하지 않게 보강 |
| 중간 타입/lint | type68189 exit0, scoped lint68968 exit0 | V2/통합 시험 최종 변경 전의 중간 결과 |

V2 alias 실제 재현(18:03:36): agent 단독4개 중2 PASS/2 FAIL, exit1,3.17초다. A(S1 create)→B(S2 migrate)→C(edit)→D(undo B), incoming B=S/incoming C=T, 기존 target B=T이면 S→T reuse/T→F fork가 된다. D의 두 self FK가 함께 있는 bounded mapping read에서 based-on T가 F로 다시 변환되었다. **status=succeeded·FK check=[]·기존 B 불변인데 D의 basis가 parent와 같은 F로 저장**되었다. 단순 정상 복원 차단과 달리 원래 undo 근거가 바뀌는 결함을 재현했다. 첫18:03:09 helper 이름 오류의4 FAIL은 제품 RED가 아니다.

root는 V2 최종 rewrite에서 provisional을 결과의 바탕으로 유지하되 mappingNeeds의 입력을 normalized 원본 source로 고정했다. SQL/lease/owner/검증 한도는 유지한다. root58890은 신규 V1 7+V2 4+기존 identity4+canonical3, **18 PASS/exit0/8.07초**다. 새 V2 역순 fixture는 조회 배열을 reverse했으며9개 이상 모든 자식이 부모보다 먼저인 경계를 증명한 것으로 표현하지 않는다.

최종 제품/시험5파일 scoped lint exit0(18:04), 타입41234 exit0다. 중간 타입7135는 작성 중 agent fixture의 잘못된 wrapCanonicalRow import를 읽어 실패했고, 동결된 실제 envelopeCanonicalRow 사용 후41234에서 해소했다.

**root23652 최종13/13 PASS, exit0,1223.76초**: 18:06:05 시작, 18:26 종료. 아래 실제 V2 이동성8개+기존 curation portability5개를 단일 workerd 자원 창에서 실행했다. 종료 후 관련10파일과 독립 검색3파일 총13개 해시 불일치0을 확인했다. 18:26:30 workerd0/포트3100 listener0을 확인하고 검색 회귀52611에 새 자원 창을 넘겼다.

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/prompt-curation-api-portability.test.ts tests/contract/v2/prompt-curation-portability.test.ts
```

기존 portability 시험의 getPlatformProxy에도 envFiles:[]만 추가했다. 단계별300초·advance당 backup/restore40 SQL, export20 SQL·600 advance 경계를 유지한다. fixture가 커져 durability 경계인 planning/명시 approval/apply를 시험 단계로 분리하며 제품 한도는 바꾸지 않는다.

### actual API 이동성8개 및 기존5개 완료

root23652의 첫 파일 **8/8 PASS**, 시험 시간946.623초다. 단계별 full134.010초, edit/undo·S2 이관·T 삭제14.962초, delta142.243초, ZIP85.138초, fresh plan185.294초/apply+검사75.430초, repeat plan183.154초/apply+검사65.628초다. 두 proxy dispose 출력 뒤 기존 portability5도 같은 자원 창에서 **5/5 PASS**했다. 기존 full/incremental V1 충돌 재매핑96.138초, V2 checkpoint 반복 복원132.927초를 포함한 두 번째 파일은272.042초다. 최종 프로세스도 exit0이며 전체 앱 suite를 뜻하지 않는다.

- full `01M2ADXT7NVHVZA3ZFHX6WJ7HM`, root `sha256:921b97d960173398dbeed1b8ae0dd4ddc954c88adae26e4e3c16b862e6a19451`.
- delta `01M2AE296BVSKXPKEWZTQE8F6W`, root `sha256:136bb02e18d1987ae1ff0a41f6627a2aaf41d16e543762b8bc37b3710119f0d5`. full에 T revision/item/example3행을 먼저 확인했고 delta에서 세 tombstone으로 제거했다. A3버전과 migrated B1버전은 모두 보존했다.
- 실제 ZIP65428 bytes, SHA256 `6fdd27654df8e5727b0d80ed6028c699833887d83154766961ff8c7f56fdb181`. full+delta materialization과46 canonical 테이블이 정확히 같다.
- fresh `01M2AE977T0MSHH4ZPPV425S57`: indexing부터 파일52개 검증/소비, 정본55 create/plan/apply, conflict/invalid/fork/rollback conflict0.
- repeat `01M2AEH5N7Y3ZKRXA9ANRW1PMM`: 다른 요청 키로 indexing부터 다시 시작, **create0/reuse55**, conflict/invalid/fork/rollback conflict0.9테이블 행·12역할별 정확 copy·정리본 이력/근거와 단일 R2 generation이 유지됐다.

합성 PNG header의 정확 바이트를 검사했으며 실제 이미지 디코딩/시각 품질·OS clipboard·원격/실제 제공자를 주장하지 않는다. 삭제 delta는 백업 상태를 구성하며 기존 사용자 DB를 강제로 삭제하는 동기화 기능이 아니다. 이전에 복원한 실제 사용자 자료를 이번 변경으로 재작성하지 않았다.

독립 후속 검토(exact_ai_evidence_review)는 두 제품 파일의 변경을 읽고 추가 확정 결함을 발견하지 못했다. planned PK·normalized owner·job sanitization·R2 key·soft/polymorphic·joined primary FK의 보존 경계를 대조했다. 실행 PASS나 모든 임의 그래프의 증명으로 확대하지 않는다.

이관/삭제 왕복과 새 결함 보완의 최종 로컬 검사를 통과했으므로 G06을75→100점으로 갱신한다. 동일한11영역 산식에서525→550/1100, **전체48%→50%**다. G07 표시 수정은 전체 match/정확 이동/뷰 완료가 아니므로25점을 유지한다. 개인 corpus·실기기·실제 제공자·현재 전체 suite/Worker/원격 운영은 별도이며 전체 goal은active다.

## 다음 G07 작업 인계 · 읽기 검토

migration_recovery_browser가 현재 코드를 대조했고 root도 retrieval-repository.ts, search-results.tsx, Record page 및 query/presentation DTO를 직접 읽었다. 보관함50건 이후 keyset·검색/저장뷰 count/offset·수동 발췌/정리본/history cursor는 이미 있으므로 재구현하지 않는다.

다음 구현 단위는 **출처별 검색 match→정확 저장 위치 열기**다. 현재 결과 DTO는 recordId/snippet/reasons만 있고 source/snapshot/run/fragment locator가 없다. 검색은 문서·연결 원문 중심이며 AI 해석/정리본 근거를 구별하지 않는다. Record page는 searchParams 없이 현재 snapshot으로 초기화한다. 기존 exact snapshot/run/manual/AI 증거 API를 재사용할 수 있다.

원문·내 글·수동 발췌·AI 해석·정리본의 code-owned match 계약, record 단위 중복 없는 count/page, 보관한 과거 원문 검색, rejection/AI 제안 표시, sensitive/restricted quote 숨김과 target 재인증, exact query parser/직접 자료 조회/포커스가 최소 완결 범위다. fragment가 첫 페이지에 없다는 이유로 현재 run의 비슷한 문구로 대체하지 않는다. 동일 문구의 다른 범위·CRLF/이모지·20개 이후 run·50개 이후 match·권한 변경·reload/back·320px/키보드와 POST/AI0을 검사한다.

저장 layout/density/groupBy/visibleFields 실제 렌더, 목적별 모듈, type/entity facet 상한과 saved-view catalog 무제한 목록은 그 다음 별도 G07 잔여다. 아래 작은 표시 보완이나 읽기 인계만으로 G07 점수를 올리지 않는다.

### 독립적인 검색 이유 표시 보완

root는 긴 workerd23652 창에서 복원 제품/시험10파일을 고정하고, 이와 독립적인 검색 repository와 새 Node SQLite 시험을 보완했다. 18:11:58 새3검사 **1 PASS/2 FAIL/exit1/1.55초**: FTS가 title/body를 title_text/body_text로 alias하지 않아 제목을 본문으로 표시했고, 보존한 user-note source 사본을 본문보다 먼저 검사하여 본문을 원본·OCR·녹취로 표시했다.

SELECT alias 및 명시 body match 우선순위를 보완했다. 기존 entity 우선순위·검색 후보/owner/privacy/count/pagination/원문은 변경하지 않았다. 후속3 PASS, 짧은 LIKE 검색까지 추가한 최종 **6 PASS/exit0/2.30초**(18:14:22), scoped3파일 lint exit0다. 최종 통합 타입92821 exit0는 이 추가 변경을 포함한다. 기존 실제 workerd retrieval13+새 SQLite6 회귀는23652 종료 후 단일 창52611에서 **19/19 PASS, exit0,61.14초**(18:26:55 시작)로 끝났다. 검색 match의 full provenance/정확 이동은 아직 미구현이다.

```powershell
npm run test --workspace @light-house/web -- --maxWorkers=1 tests/contract/v2/retrieval.test.ts tests/contract/v2/retrieval-match-reason.test.ts
```

기존13개는 기록53건의 두 번째 페이지/권한 제외 count, ownerless cross-user source fence, 한국어 제목·본문·OCR, sensitive/restricted 숨김, FTS 동기화, 필터/저장 뷰·템플릿·재발견 경계를 포함한다. 신규6개와 중복 실행한 이전 결과를 합산하지 않는다. 코드 변경은 제품3파일·시험6파일이며, scoped lint는 해당9파일 모두 exit0다. 타입/명령의 최종 exit와 아래 지문은 현재 코드의 해당 검사 범위에 한정한다. 이번 변경으로 앱 전체 suite·브라우저·Worker 빌드를 다시 실행하지 않았으며 과거 성공을 현재 성공으로 바꾸지 않는다.

## 통합 시작 지문 · 18:05:53 KST

앱 기준 경로, SHA-256이다. 23652 종료 후 아래10개와 검색3개 모두 재계산하여 불일치0을 확인했다. 검색 회귀 종료 후18:35:11 최종 재계산에서도13개 모두 일치했다.

| 파일 | SHA-256 |
| --- | --- |
| src/lib/v2/portability/restore-bundle-v1.ts | `9DAD99FBC28AF6A7151AD3BEB13733F9248BAD26DF02C45758E4ED1FBBB824FC` |
| src/lib/v2/portability/resumable-restore-v2.ts | `D7267B6D4A133CB7F0B51942DA6434981E7958BE297C062D73B90015AEA384D5` |
| src/lib/v2/portability/resumable-backup-v2.ts | `CD9CDC82B0B6E2DDEDC95E70FC27C821EFD306961FEC09A3546E1857EC29D6FC` |
| src/lib/v2/portability/resumable-export-v2.ts | `14B65EFB85ABB2A50CF1B51F214A2BABE92F74BCC7375FAFE22A42C26C69980A` |
| src/lib/v2/infrastructure/d1/prompt-curation-repository.ts | `81DDE87CA6235BF75521D30773017FAAAE4B71480878B6076662F003EA10429A` |
| src/lib/v2/infrastructure/d1/prompt-curation-catalog.ts | `668892BB662C90926E0B92DB97175E644A2D5454E4C580DE9DB3640CD52EC7F4` |
| tests/contract/v2/prompt-curation-api-portability.test.ts | `1807CBD6C689F66AD0A1A62CEC8802C5A1D9933AEA04C0D80C1013067DB2E7BB` |
| tests/contract/v2/prompt-curation-migration-restore.test.ts | `A096041D1E6C02F8B20DC82F95BB422CD588DF439D3CA6B8F7AF71E245932955` |
| tests/contract/v2/prompt-curation-resumable-restore-alias.test.ts | `B3AA9115AC2BC36A1A7683BE770297639655AC1CE8DB5EE462CBDEF9A21F9CB8` |
| tests/contract/v2/prompt-curation-portability.test.ts | `0FB480688D4D72143CEA3C53EC44DF5B00BCA45DA59CA8BC61A364EEAA1104A9` |

검색3파일은 별도18:15 동결 지문이다.

| 파일 | SHA-256 |
| --- | --- |
| src/lib/v2/infrastructure/d1/retrieval-repository.ts | `503C6C1EE5655AF42CB5662C1E3C5DC75865716156D9E614A3EB22A90851F491` |
| tests/contract/v2/retrieval-match-reason.test.ts | `31AD9E61826BE33C3A7AEBD8E53CCE810E7CCCA0D5E7148B75D331531B9DE9A1` |
| tests/contract/v2/retrieval.test.ts | `36628FBD77E71CEB02BA5F8816F2452F0D7950EDC8A7C4C6BA30A96D385C461B` |

## 최종 인계 확인 · 18:35 KST

- 최종18:35:11 재해시13개 일치, workerd0, 포트3100 listener0. root23652/52611/92821은 모두 최종exit0의 종료 핸들이다. 서버 재개나 잔여 시험 대기 없음.
- 변경 문서5개(50/59/69/CURRENT/README)의 로컬 링크86개 검사, 누락0/exit0. git diff --check도 exit0이며 기존 tracked 파일의 LF→CRLF 경고만 있었다. 대부분 V2 파일이 untracked인 현재 저장소에서 이 Git 검사만으로 V2 품질을 증명하지 않는다. 제품/시험은 위 lint·타입·실행 결과와 지문으로 확인했다.
- exact_ai_evidence_review의 별도 최종 읽기 검토에서54번 G06 계약과50번 완료표, 실제 API 시험을 대조했다. G06 필수 로컬 범위 누락·범위 삭제·50% 산식 오류는 발견하지 못했다. 기존 깊은 HTTP/repository cursor 근거와 이번 이관/삭제 이동성을 구별했고 자동 수집/OCR/영상·실제 OS를 G06에 새로 포함하지 않았다.
- 검토 당시69번에 남아 있던 검사 진행 중/재해시 예정 표현은 최종19 PASS와 실제 종료 결과로 갱신했다. 이 문서 검토는 추가 시험이나 운영 승인으로 계산하지 않는다.
