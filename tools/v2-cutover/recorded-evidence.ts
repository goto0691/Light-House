import type { CutoverGate } from "../../apps/web/src/lib/v2/cutover/cutover-contract-v1";
import { canonical, identity, type Expected } from "../v2-eval/contracts";
import { parseReport, type EvaluationReport } from "../v2-eval/report";

export type CorpusReadiness = {
  current_hashes_verified: boolean;
  human_approved_cases: number;
  ready_cases: number;
  user_delegated_cases?: number;
};

export type CutoverCorpusSnapshot = {
  corpus_sha256: string;
  expected: Expected[];
  readiness?: CorpusReadiness;
};

function gate(key: string, label: string, passed: boolean, required: string): CutoverGate {
  return { key, label, passed, actual: passed ? "verified" : "unverified", required };
}

function approvals(readiness: CorpusReadiness) {
  return readiness.human_approved_cases + (readiness.user_delegated_cases ?? 0);
}

/** Consumes validated recordings; it never turns foundation results into live or rubric evidence. */
export function verifyRecordedCutoverEvidence(input: {
  report: unknown;
  expectedIdentity: unknown;
  corpus: CutoverCorpusSnapshot | null;
  currentBuildSha: string | null;
  sourceClean: boolean;
}) {
  let report: EvaluationReport | null = null;
  let identityMatches = false;
  let currentBuildMatches = false;
  try { report = parseReport(input.report); } catch { /* Malformed or edited reports remain unverified. */ }
  try {
    const expectedIdentity = identity(input.expectedIdentity);
    currentBuildMatches = expectedIdentity.build_sha === input.currentBuildSha;
    identityMatches = report !== null && canonical(report.identity) === canonical(expectedIdentity);
  } catch { /* Missing or invalid expected identity cannot select a release candidate. */ }

  const currentHumanCount = input.corpus?.expected.filter((item) => item.authoring_status === "human_approved").length ?? 0;
  const currentDelegatedCount = input.corpus?.expected.filter((item) => String(item.authoring_status) === "assistant_reviewed").length ?? 0;
  const readiness: CorpusReadiness = input.corpus?.readiness ?? {
    current_hashes_verified: input.corpus !== null,
    human_approved_cases: currentHumanCount,
    user_delegated_cases: currentDelegatedCount,
    ready_cases: input.corpus?.expected.length ?? 0,
  };
  const corpusReady = input.corpus?.expected.length === 20 && readiness.current_hashes_verified && readiness.ready_cases === 20 && approvals(readiness) === 20
    && readiness.human_approved_cases === currentHumanCount && (readiness.user_delegated_cases ?? 0) === currentDelegatedCount;
  const corpusMatches = report !== null && input.corpus !== null
    && report.corpus_sha256 === input.corpus.corpus_sha256
    && canonical(report.cases.map((item) => item.case_id).sort()) === canonical(input.corpus.expected.map((item) => item.case_id).sort());
  const reportReadiness = report?.readiness as CorpusReadiness | undefined;
  const readinessMatches = report?.mode === "private-recorded" && corpusReady && reportReadiness !== undefined
    && reportReadiness.current_hashes_verified
    && reportReadiness.ready_cases === readiness.ready_cases
    && reportReadiness.human_approved_cases === readiness.human_approved_cases
    && (reportReadiness.user_delegated_cases ?? 0) === (readiness.user_delegated_cases ?? 0);
  const bound = report !== null && identityMatches && currentBuildMatches && input.sourceClean && corpusMatches && readinessMatches;
  const gates = [
    gate("recorded_report", "기록 평가 보고서 구조·집계 검증", report !== null, "validated recorded-evaluation-v1 report"),
    gate("candidate_identity", "평가 후보 identity 일치", identityMatches && currentBuildMatches, "report identity equals explicit current candidate identity"),
    gate("candidate_source_clean", "평가 후보 소스 고정", input.sourceClean, "no uncommitted release source changes"),
    gate("recorded_corpus", "현재 corpus와 평가 대상 일치", corpusMatches, "current source/expected digest and exact case set"),
    gate("recorded_readiness", "평가 자료 승인 상태 일치", readinessMatches, "20 ready approved cases with matching approval counts"),
    gate("recorded_fatal", "평가 fatal failure", bound && report?.aggregate.fatal_count === 0, "zero recorded fatal failures"),
    gate("recorded_unknown", "미평가 기준", bound && report?.aggregate.unknown_count === 0, "zero unknown criteria"),
    gate("recorded_deterministic", "결정론적 평가 실패", bound && report?.aggregate.major_count === 0, "zero recorded deterministic failures"),
    gate("recorded_live_provider", "실제 공급자 평가 증거", bound && Boolean(report?.live_provider_verified), "independently verified live provider evidence; recordings alone are insufficient"),
    gate("recorded_rubric", "독립 rubric 평가 증거", false, "independent scored rubric; foundation report is not_scored"),
    gate("recorded_promotion", "평가의 출시 판단", bound && Boolean(report?.promotion.eligible), "eligible evaluator report; foundation promotion remains false"),
  ];
  const recall = bound && report ? report.aggregate.metrics.query_all_required_top10.rate : null;
  return {
    gates,
    readyCount: corpusReady ? readiness.ready_cases : 0,
    approvedExpectedCount: corpusReady ? approvals(readiness) : 0,
    fatalFailureCount: bound && report ? report.aggregate.fatal_count : 0,
    recallTop10Rate: recall,
    evaluationPassed: gates.every((item) => item.passed),
  };
}
