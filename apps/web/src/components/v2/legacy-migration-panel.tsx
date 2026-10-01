"use client";

import { CheckCircle2, FileArchive, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ACTIVE_LEGACY_MIGRATION_STORAGE_KEY,
  classifyLegacyBatch,
  dryRunMatchesBatch,
  LEGACY_QUARANTINE_REQUESTS_STORAGE_KEY,
  legacyModeLabel,
  legacyRunMaterializedBatch,
  parseStoredLegacyMigration,
  type LegacyBatchDetail,
  type LegacyDryRun,
  type LegacyInventory,
  type LegacyMigrationBatch,
  type LegacyMigrationMode,
  type LegacyRunResult,
  type StoredLegacyMigration,
} from "@/components/v2/legacy-migration-state";

const LEGACY_ROWS_PER_ACTION = 100;
const MAX_LEGACY_PROJECTION_CONTINUATIONS = 9;
const MAX_LEGACY_GATE_ADVANCES_PER_ACTION = 8;

type QuarantineRequest = Readonly<{ idempotencyKey: string; reason: string }>;

async function json(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string }; [key: string]: unknown };
  if (!response.ok) throw new Error(body.error?.message || "요청을 완료하지 못했습니다.");
  return body;
}

function mergeBatch(current: LegacyMigrationBatch[], batch: LegacyMigrationBatch) {
  return [batch, ...current.filter((item) => item.id !== batch.id)];
}

function displayBatchTimestamp(batch: LegacyMigrationBatch) {
  const raw = batch.reconciledAt ?? batch.finishedAt ?? batch.startedAt ?? batch.approvedAt ?? batch.createdAt;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("ko-KR");
}

function readQuarantineRequests() {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_QUARANTINE_REQUESTS_STORAGE_KEY) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, QuarantineRequest>;
    return value as Record<string, QuarantineRequest>;
  } catch {
    return {} as Record<string, QuarantineRequest>;
  }
}

function quarantineRequestFor(batchId: string, reason: string) {
  const requests = readQuarantineRequests();
  const previous = requests[batchId];
  if (previous && typeof previous.idempotencyKey === "string" && typeof previous.reason === "string") return previous;
  const request = { idempotencyKey: crypto.randomUUID(), reason };
  localStorage.setItem(LEGACY_QUARANTINE_REQUESTS_STORAGE_KEY, JSON.stringify({ ...requests, [batchId]: request }));
  return request;
}

export function LegacyMigrationPanel({ ensureRestricted }: { ensureRestricted: () => Promise<void> }) {
  const [inventory, setInventory] = useState<LegacyInventory[]>([]);
  const [batches, setBatches] = useState<LegacyMigrationBatch[]>([]);
  const [table, setTable] = useState("");
  const [dryRun, setDryRun] = useState<LegacyDryRun | null>(null);
  const [approved, setApproved] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [mode, setMode] = useState<LegacyMigrationMode>("source_only");
  const [serverOffset, setServerOffset] = useState(0);
  const [serverRevision, setServerRevision] = useState<number | null>(null);
  const [serverStateVerified, setServerStateVerified] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<LegacyBatchDetail | null>(null);
  const [contractMatchesBatch, setContractMatchesBatch] = useState<boolean | null>(null);
  const [result, setResult] = useState<LegacyRunResult | null>(null);
  const [restrictedReady, setRestrictedReady] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [quarantineReason, setQuarantineReason] = useState("");

  const busy = Boolean(busyLabel);
  const selectedDisposition = useMemo(
    () => selectedDetail ? classifyLegacyBatch(selectedDetail.batch, selectedDetail.reconciliation) : null,
    [selectedDetail],
  );
  const reconciliation = selectedDetail?.reconciliation ?? result?.reconciliation ?? null;
  const preservationGate = selectedDetail?.preservationGate ?? result?.preservationGate ?? null;
  const complete = selectedDisposition?.kind === "complete" || result?.complete === true;
  const currentContractMatches = selectedDetail ? contractMatchesBatch === true : contractMatchesBatch !== false;
  const canContinue = Boolean(
    dryRun
    && batchId
    && approved
    && serverStateVerified
    && currentContractMatches
    && !complete
    && (!selectedDisposition || selectedDisposition.resumable),
  );
  const canPrepareKnowledge = Boolean(
    mode === "source_only"
    && complete
    && reconciliation?.structurally_valid === true
    && currentContractMatches,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = parseStoredLegacyMigration(localStorage.getItem(ACTIVE_LEGACY_MIGRATION_STORAGE_KEY));
      if (stored) {
        setBatchId(stored.batchId);
        setTable(stored.table);
        setMode(stored.mode);
        setDryRun(stored.dryRunContract);
        setServerOffset(stored.serverOffset);
        setServerRevision(stored.stateRevision);
        setServerStateVerified(stored.stateRevision === null && stored.serverOffset === 0);
        setContractMatchesBatch(stored.dryRunContract.dryRunHash === stored.batchDryRunHash);
        setStatusMessage(stored.stateRevision === null
          ? "저장된 새 batch 계약을 복구했습니다. 아직 서버 offset은 0입니다."
          : "저장된 batch를 찾았습니다. 계속하기 전에 서버 상태를 복구하세요.");
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (!batchId || !dryRun) {
      localStorage.removeItem(ACTIVE_LEGACY_MIGRATION_STORAGE_KEY);
      return;
    }
    const stored: StoredLegacyMigration = {
      version: 1,
      batchId,
      table: dryRun.table,
      mode,
      batchDryRunHash: selectedDetail?.batch.dryRunHash ?? dryRun.dryRunHash,
      dryRunContract: dryRun,
      serverOffset,
      stateRevision: serverRevision,
    };
    localStorage.setItem(ACTIVE_LEGACY_MIGRATION_STORAGE_KEY, JSON.stringify(stored));
  }, [batchId, dryRun, mode, selectedDetail, serverOffset, serverRevision, storageReady]);

  function clearErrors() {
    setListError("");
    setDetailError("");
    setActionError("");
  }

  function applyServerDetail(detail: LegacyBatchDetail) {
    setSelectedDetail(detail);
    setBatchId(detail.batch.id);
    setTable(detail.batch.table);
    setMode(detail.batch.mode);
    setServerOffset(detail.batch.nextOffset);
    setServerRevision(detail.batch.stateRevision);
    setServerStateVerified(true);
    setBatches((current) => mergeBatch(current, detail.batch));
  }

  async function fetchBatchDetail(id: string) {
    return await json(await fetch(`/api/v2/migration/batches/${encodeURIComponent(id)}`, {
      headers: { "Cache-Control": "no-store" },
    })) as LegacyBatchDetail;
  }

  async function createDryRun(targetTable: string) {
    const body = await json(await fetch("/api/v2/migration/dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: targetTable }),
    })) as { dryRun: LegacyDryRun };
    return body.dryRun;
  }

  async function fetchRecentBatches() {
    const body = await json(await fetch("/api/v2/migration/batches", {
      headers: { "Cache-Control": "no-store" },
    })) as { batches: LegacyMigrationBatch[] };
    setBatches(body.batches);
    return body.batches;
  }

  async function recoverBatchAfterGrant(id: string) {
    const detail = await fetchBatchDetail(id);
    const currentDryRun = await createDryRun(detail.batch.table);
    applyServerDetail(detail);
    setDryRun(currentDryRun);
    setResult(null);
    const matches = dryRunMatchesBatch(currentDryRun, detail.batch);
    setContractMatchesBatch(matches);
    const disposition = classifyLegacyBatch(detail.batch, detail.reconciliation);
    setApproved(matches && disposition.resumable);
    setQuarantineReason(typeof detail.batch.quarantine?.reason === "string" ? detail.batch.quarantine.reason : "");
    if (!matches) {
      setStatusMessage("현재 원본으로 다시 만든 dry-run hash가 이 batch 계약과 다릅니다. 같은 batch는 진행하지 말고 새 dry-run으로 시작하세요.");
    } else {
      setStatusMessage(`${detail.batch.table} batch의 서버 offset ${detail.batch.nextOffset}, revision ${detail.batch.stateRevision}을 복구했습니다. ${disposition.message}`);
    }
    return detail;
  }

  async function loadWorkspace() {
    setBusyLabel("레거시 목록과 최근 batch를 확인하는 중…");
    clearErrors();
    try {
      await ensureRestricted();
      setRestrictedReady(true);
      const [inventoryBody, recent] = await Promise.all([
        json(await fetch("/api/v2/migration/inventory", { headers: { "Cache-Control": "no-store" } })) as Promise<{ inventory: LegacyInventory[] }>,
        fetchRecentBatches(),
      ]);
      setInventory(inventoryBody.inventory);
      if (!table) setTable(inventoryBody.inventory.find((item) => item.rows > 0 && item.valid)?.table ?? "");
      if (batchId && recent.some((batch) => batch.id === batchId)) await recoverBatchAfterGrant(batchId);
      else setStatusMessage(`어댑터 ${inventoryBody.inventory.length}개와 최근 batch ${recent.length}개를 확인했습니다.`);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "레거시 목록을 읽지 못했습니다.");
    } finally {
      setBusyLabel("");
    }
  }

  async function refreshBatches() {
    setBusyLabel("최근 batch를 새로고침하는 중…");
    setListError("");
    try {
      await ensureRestricted();
      setRestrictedReady(true);
      const recent = await fetchRecentBatches();
      setStatusMessage(`최근 batch ${recent.length}개를 서버에서 확인했습니다.`);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "최근 batch를 읽지 못했습니다.");
    } finally {
      setBusyLabel("");
    }
  }

  async function recoverBatch(id: string) {
    setBusyLabel("batch 상세와 현재 dry-run을 대조하는 중…");
    setDetailError("");
    setActionError("");
    try {
      await ensureRestricted();
      setRestrictedReady(true);
      await recoverBatchAfterGrant(id);
    } catch (error) {
      setServerStateVerified(false);
      setDetailError(error instanceof Error ? error.message : "batch 상세 상태를 복구하지 못했습니다.");
    } finally {
      setBusyLabel("");
    }
  }

  function resetForTable(nextTable: string) {
    setTable(nextTable);
    setDryRun(null);
    setApproved(false);
    setBatchId("");
    setMode("source_only");
    setServerOffset(0);
    setServerRevision(null);
    setServerStateVerified(true);
    setSelectedDetail(null);
    setContractMatchesBatch(null);
    setResult(null);
    setDetailError("");
    setActionError("");
    setStatusMessage("");
  }

  async function inspectLegacy() {
    if (!table) return;
    setBusyLabel("변경 없이 dry-run을 만드는 중…");
    setActionError("");
    setDetailError("");
    setDryRun(null);
    setApproved(false);
    setResult(null);
    setMode("source_only");
    setServerOffset(0);
    setServerRevision(null);
    setServerStateVerified(true);
    setSelectedDetail(null);
    setContractMatchesBatch(null);
    const nextBatchId = crypto.randomUUID();
    setBatchId(nextBatchId);
    try {
      await ensureRestricted();
      setRestrictedReady(true);
      const currentDryRun = await createDryRun(table);
      setDryRun(currentDryRun);
      setContractMatchesBatch(true);
      setStatusMessage(`새 ${legacyModeLabel("source_only")} batch ${nextBatchId}의 dry-run 계약을 저장했습니다.`);
    } catch (error) {
      setBatchId("");
      setActionError(error instanceof Error ? error.message : "레거시 dry-run을 만들지 못했습니다.");
    } finally {
      setBusyLabel("");
    }
  }

  function startNewBatchFromCurrentDryRun() {
    if (!dryRun) return;
    const nextBatchId = crypto.randomUUID();
    setBatchId(nextBatchId);
    setMode("source_only");
    setServerOffset(0);
    setServerRevision(null);
    setServerStateVerified(true);
    setSelectedDetail(null);
    setContractMatchesBatch(true);
    setApproved(false);
    setResult(null);
    setStatusMessage(`현재 dry-run으로 새 원본 보존 batch ${nextBatchId}를 준비했습니다.`);
  }

  async function runLegacyChunk() {
    if (!dryRun || !batchId || !canContinue) return;
    setBusyLabel("서버 상태를 확인하고 안전하게 진행하는 중…");
    setActionError("");
    setDetailError("");
    let batchMayExist = serverRevision !== null || Boolean(selectedDetail);
    try {
      await ensureRestricted();
      setRestrictedReady(true);
      let nextOffset = serverOffset;
      if (serverRevision !== null || selectedDetail) {
        const latest = await fetchBatchDetail(batchId);
        applyServerDetail(latest);
        const disposition = classifyLegacyBatch(latest.batch, latest.reconciliation);
        if (!disposition.resumable) throw new Error(disposition.message);
        if (!dryRunMatchesBatch(dryRun, latest.batch)) throw new Error("현재 dry-run hash가 서버 batch 계약과 달라 진행할 수 없습니다. 새 dry-run을 만드세요.");
        nextOffset = latest.batch.nextOffset;
      } else if (serverOffset !== 0) {
        throw new Error("저장된 offset은 진행 근거로 사용할 수 없습니다. 서버 batch 상태를 먼저 복구하세요.");
      }

      let remainingRows = LEGACY_ROWS_PER_ACTION;
      let sameRowContinuations = 0;
      let gateAdvances = 0;
      let previousGateProgress = "";
      while (remainingRows > 0) {
        const body = await json(await fetch("/api/v2/migration/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table: dryRun.table,
            importBatchId: batchId,
            mode,
            dryRunHash: dryRun.dryRunHash,
            approved: true,
            offset: nextOffset,
            limit: 1,
          }),
        })) as { result: LegacyRunResult };
        setResult(body.result);
        setServerOffset(body.result.nextOffset);
        if (legacyRunMaterializedBatch(body.result)) {
          batchMayExist = true;
          setServerStateVerified(false);
        }
        if (body.result.complete) break;
        if (body.result.gatePending && body.result.preservationGate) {
          const progress = `${body.result.preservationGate.tablesChecked}:${body.result.preservationGate.rowsChecked}:${body.result.preservationGate.currentRowOffset}`;
          if (progress === previousGateProgress) throw new Error("전체 원본 보존 대조 위치가 바뀌지 않아 안전하게 중단했습니다.");
          previousGateProgress = progress;
          gateAdvances += 1;
          if (gateAdvances >= MAX_LEGACY_GATE_ADVANCES_PER_ACTION) break;
          continue;
        }
        if (body.result.nextOffset > nextOffset) {
          remainingRows -= Math.min(remainingRows, body.result.nextOffset - nextOffset);
          nextOffset = body.result.nextOffset;
          sameRowContinuations = 0;
          continue;
        }
        if (body.result.nextOffset === nextOffset && (body.result.batchPrepared === true || body.result.rowPending && body.result.processedProjections === 1)) {
          sameRowContinuations += 1;
          if (sameRowContinuations >= MAX_LEGACY_PROJECTION_CONTINUATIONS) throw new Error("한 레거시 행의 투영 수가 안전 한도를 넘어 중단했습니다.");
          continue;
        }
        throw new Error("서버 진행 위치가 바뀌지 않아 안전하게 중단했습니다.");
      }

      if (batchMayExist) {
        const latest = await fetchBatchDetail(batchId);
        applyServerDetail(latest);
        setContractMatchesBatch(dryRunMatchesBatch(dryRun, latest.batch));
        const disposition = classifyLegacyBatch(latest.batch, latest.reconciliation);
        setStatusMessage(`${latest.batch.table} · 서버 offset ${latest.batch.nextOffset}/${latest.batch.inputRows} · ${disposition.label}`);
      } else {
        setServerRevision(null);
        setServerStateVerified(true);
        setStatusMessage("지식 투영 전 전체 원본 보존 대조가 진행 중입니다. target batch는 아직 생성되지 않았으며 같은 ID로 계속할 수 있습니다.");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "레거시 batch를 진행하지 못했습니다.");
      if (batchMayExist) setServerStateVerified(false);
    } finally {
      setBusyLabel("");
    }
  }

  function prepareLegacyKnowledge() {
    if (!dryRun || !canPrepareKnowledge) return;
    const nextBatchId = crypto.randomUUID();
    setMode("knowledge");
    setServerOffset(0);
    setServerRevision(null);
    setServerStateVerified(true);
    setBatchId(nextBatchId);
    setApproved(false);
    setResult(null);
    setSelectedDetail(null);
    setContractMatchesBatch(true);
    setActionError("");
    setDetailError("");
    setStatusMessage(`같은 dry-run hash로 지식 투영 batch ${nextBatchId}를 준비했습니다.`);
  }

  async function quarantineSelectedBatch() {
    if (!selectedDetail) return;
    const trimmedReason = quarantineReason.trim();
    if (!trimmedReason) {
      setActionError("격리 사유를 입력하세요.");
      return;
    }
    const confirmed = window.confirm("이 batch를 격리할까요? envelope와 원본은 보존되고, 이 batch가 만든 투영만 보관함에서 숨겨집니다.");
    if (!confirmed) return;
    setBusyLabel("서버 revision을 확인하고 batch를 격리하는 중…");
    setActionError("");
    setDetailError("");
    try {
      await ensureRestricted();
      setRestrictedReady(true);
      const latest = await fetchBatchDetail(selectedDetail.batch.id);
      applyServerDetail(latest);
      if (classifyLegacyBatch(latest.batch, latest.reconciliation).kind === "quarantined") {
        setStatusMessage("서버에서 이미 격리가 완료된 batch입니다.");
        return;
      }
      const request = quarantineRequestFor(latest.batch.id, trimmedReason);
      if (request.reason !== trimmedReason) {
        setQuarantineReason(request.reason);
        setStatusMessage("이전 격리 요청과 같은 idempotency key·사유로 재시도합니다.");
      }
      const body = await json(await fetch(`/api/v2/migration/batches/${encodeURIComponent(latest.batch.id)}/quarantine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: latest.batch.stateRevision,
          idempotencyKey: request.idempotencyKey,
          reason: request.reason,
        }),
      })) as { result: { disposition: string; batch: LegacyMigrationBatch; reconciliation: LegacyBatchDetail["reconciliation"]; preservationGate: LegacyBatchDetail["preservationGate"] } };
      const detail = { batch: body.result.batch, reconciliation: body.result.reconciliation, preservationGate: body.result.preservationGate };
      applyServerDetail(detail);
      setApproved(false);
      setContractMatchesBatch(dryRunMatchesBatch(dryRun, body.result.batch));
      setStatusMessage(`격리 ${body.result.disposition === "replayed" ? "재확인" : "완료"}: envelope와 원본은 보존되고 투영만 숨겨졌습니다.`);
      await fetchRecentBatches();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "batch를 격리하지 못했습니다. 같은 요청 키로 다시 시도할 수 있습니다.");
    } finally {
      setBusyLabel("");
    }
  }

  return <section className="v2-portability-panel v2-portability-backup">
    <header><FileArchive aria-hidden="true" size={21} /><div><h2>이전 데이터 가져오기</h2><p>원본 envelope를 먼저 보존한 뒤 결정적인 정보만 별도 투영합니다.</p></div></header>
    <div className="v2-portability-backup-actions">
      <button className="v2-portability-secondary" disabled={busy} onClick={loadWorkspace} type="button">레거시 목록·batch 확인</button>
      {inventory.length ? <select aria-label="레거시 테이블" onChange={(event) => resetForTable(event.target.value)} value={table}><option value="">테이블 선택</option>{inventory.filter((item) => item.rows > 0).map((item) => <option disabled={!item.valid} key={item.table} value={item.table}>{item.table} · {item.rows}행{item.valid ? "" : " · coverage 실패"}</option>)}</select> : null}
      <button className="v2-portability-primary" disabled={!table || busy} onClick={inspectLegacy} type="button">변경 없이 dry-run</button>
    </div>
    {inventory.length ? <p className="v2-portability-backup-note">어댑터 {inventory.length}개 · 데이터가 있는 테이블 {inventory.filter((item) => item.rows > 0).length}개 · coverage 실패 {inventory.filter((item) => item.rows > 0 && !item.valid).length}개</p> : <p className="v2-portability-backup-note">비밀번호 재확인 후 row 수·column coverage와 최근 batch 상태만 읽습니다. 원문은 목록 응답에 포함하지 않습니다.</p>}
    {busyLabel || statusMessage ? <p className="v2-portability-status" aria-live="polite" role="status">{busyLabel || statusMessage}</p> : null}
    {listError ? <p className="v2-portability-error" role="alert">목록: {listError}</p> : null}

    {restrictedReady ? <div className="v2-portability-jobs v2-portability-migration-batches">
      <div className="v2-portability-section-heading"><h3>최근 migration batch</h3><button disabled={busy} onClick={refreshBatches} type="button">새로고침</button></div>
      {batches.length ? batches.slice(0, 12).map((batch) => {
        const disposition = classifyLegacyBatch(batch);
        return <article data-selected={selectedDetail?.batch.id === batch.id ? "true" : "false"} key={batch.id}>
          <div><strong>{batch.table} · {legacyModeLabel(batch.mode)} · {disposition.label}</strong><small>batch {batch.id} · offset {batch.nextOffset}/{batch.inputRows} · revision {batch.stateRevision}</small><small>control {batch.controlStatus} · reconciliation {batch.reconciliationStatus} · {displayBatchTimestamp(batch)}</small>{batch.failureCode ? <small className="v2-portability-failure-code">실패 코드 {batch.failureCode}</small> : null}</div>
          <span className="v2-portability-job-actions"><button aria-label={`${batch.table} batch ${batch.id} 서버 상태 복구`} disabled={busy} onClick={() => recoverBatch(batch.id)} type="button">상태 복구</button></span>
        </article>;
      }) : <p className="v2-portability-backup-note">아직 서버에 생성된 migration batch가 없습니다.</p>}
    </div> : null}

    {!serverStateVerified && batchId ? <div className="v2-portability-warning"><ShieldAlert aria-hidden="true" size={17} /><p><strong>로컬 offset으로는 진행하지 않습니다.</strong><span>batch {batchId}의 상세 GET으로 서버 offset과 revision을 먼저 복구하세요.</span></p><button disabled={busy} onClick={() => recoverBatch(batchId)} type="button">서버 상태 복구</button></div> : null}
    {detailError ? <p className="v2-portability-error" role="alert">상세: {detailError}</p> : null}

    {dryRun ? <div className="v2-portability-dry-run">
      <header><CheckCircle2 aria-hidden="true" size={18} /><div><strong>{dryRun.table} · {legacyModeLabel(mode)}</strong><small>{dryRun.adapterVersion} · dry-run {dryRun.dryRunHash.slice(0, 18)}… · batch {batchId}</small></div></header>
      <dl><div><dt>입력 행</dt><dd>{dryRun.inputRows}</dd></div><div><dt>글 투영</dt><dd>{dryRun.projectedDocuments}</dd></div><div><dt>보존 전용</dt><dd>{dryRun.archivedRows}</dd></div><div><dt>서버 offset</dt><dd>{serverOffset}</dd></div></dl>
      {Object.keys(dryRun.damageCodes).length ? <p>손상 표식: {Object.entries(dryRun.damageCodes).map(([key, value]) => `${key} ${value}`).join(" · ")}</p> : null}
      {selectedDetail && selectedDisposition ? <p className={`v2-portability-batch-state is-${selectedDisposition.kind}`}>{selectedDisposition.label} · {selectedDisposition.message} · server revision {selectedDetail.batch.stateRevision}</p> : null}
      {selectedDetail && contractMatchesBatch === false ? <div className="v2-portability-warning"><ShieldAlert aria-hidden="true" size={17} /><p><strong>dry-run 계약 불일치</strong><span>현재 hash와 batch의 {selectedDetail.batch.dryRunHash.slice(0, 18)}…가 달라 같은 batch를 진행할 수 없습니다.</span></p><button disabled={busy} onClick={startNewBatchFromCurrentDryRun} type="button">이 dry-run으로 새 batch 준비</button></div> : null}
      {selectedDisposition?.kind === "stale" && contractMatchesBatch !== false ? <button className="v2-portability-secondary" disabled={busy} onClick={startNewBatchFromCurrentDryRun} type="button">새 dry-run batch로 전환</button> : null}
      <p>{mode === "source_only" ? "모든 테이블의 1단계 보존과 대조를 끝내기 전에는 2단계로 넘어가지 마세요." : "이 테이블의 보존 batch와 같은 dry-run hash일 때만 지식 투영이 허용됩니다."} 서버는 요청당 투영 1개만 처리하고, 행의 모든 투영이 끝난 뒤 offset을 이동합니다. 한 번 누르면 최대 {LEGACY_ROWS_PER_ACTION}행을 순차 실행합니다.</p>
      {!complete && (!selectedDisposition || selectedDisposition.resumable) && currentContractMatches ? <label><input checked={approved} onChange={(event) => setApproved(event.target.checked)} type="checkbox" /><span>{mode === "source_only" ? "row hash와 원본 보존 수를 확인했습니다." : "전체 원본 보존·대조가 끝났으며 결정적 투영을 진행합니다."}</span></label> : null}
      <button className="v2-portability-primary" disabled={!canContinue || busy} onClick={runLegacyChunk} type="button">{busy ? "안전하게 진행 중…" : result?.gatePending ? "전체 원본 보존 대조 계속" : mode === "source_only" ? `최대 ${LEGACY_ROWS_PER_ACTION}행 원본 보존` : `최대 ${LEGACY_ROWS_PER_ACTION}행 지식 투영`}</button>
      {canPrepareKnowledge ? <button className="v2-portability-secondary" disabled={busy} onClick={prepareLegacyKnowledge} type="button">전체 1단계 대조 후 이 테이블 2단계 준비</button> : null}
      {preservationGate ? <p>전체 원본 보존 대조 · 테이블 {preservationGate.tablesChecked}/{preservationGate.tablesTotal} · 행 {preservationGate.rowsChecked}/{preservationGate.rowsTotal}{preservationGate.currentTable ? ` · ${preservationGate.currentTable}` : ""}{preservationGate.failureCode ? ` · ${preservationGate.failureCode}` : ""}</p> : reconciliation ? <p>envelope {reconciliation.envelope_count ?? 0} · projected {reconciliation.projected_count ?? 0} · archived {reconciliation.archived_count ?? 0}{result?.rowPending ? " · 같은 행 계속 처리 중" : ""}{complete ? " · 단계 완료" : ""}</p> : null}
    </div> : null}

    {selectedDetail ? <fieldset className="v2-portability-quarantine" disabled={busy || selectedDisposition?.kind === "quarantined"}>
      <legend>문제가 있는 batch 격리</legend>
      <label htmlFor="legacy-quarantine-reason">격리 사유</label>
      <textarea id="legacy-quarantine-reason" maxLength={1000} onChange={(event) => setQuarantineReason(event.target.value)} placeholder="예: 일부 투영이 잘못 분류되어 보관함에서 숨김" rows={3} value={quarantineReason} />
      <p>격리해도 envelope와 원본은 삭제되지 않고 그대로 보존됩니다. 이 batch가 만든 투영만 보관함에서 숨깁니다.</p>
      <button className="v2-portability-secondary" disabled={busy || !quarantineReason.trim() || selectedDisposition?.kind === "quarantined"} onClick={quarantineSelectedBatch} type="button">사유 확인 후 batch 격리</button>
    </fieldset> : null}
    {actionError ? <p className="v2-portability-error" role="alert">작업: {actionError}</p> : null}
  </section>;
}
