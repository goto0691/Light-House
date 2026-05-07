"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, EyeOff, Gauge, Map, Save, Settings2, UploadCloud } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import {
  CollectionColumnControls,
  savedViewColumnKeys,
  type CollectionColumnDefinition,
} from "@/components/shared/collection-column-controls";
import { CollectionShell } from "@/components/shared/collection-shell";
import { GlassCard } from "@/components/shared/glass-card";
import { SavedViewManager } from "@/components/shared/saved-view-manager";
import { SavedViewTabs } from "@/components/shared/saved-view-tabs";
import {
  createSavedViewClient,
  deleteSavedViewClient,
  getDefaultSavedViewKey,
  getSavedViewKey,
  isPersistedSavedView,
  slugifySavedViewKey,
  updateSavedViewClient,
} from "@/lib/saved-view-client";
import type { SavedView } from "@/lib/server/ui-state";
import type {
  SourceMappingClassificationStatus,
  SourcePropertyBatchApplyResult,
  SourcePropertyMappingRuleStatus,
  SourcePropertyWorkbench,
  SourceWorkbenchProperty,
} from "@/lib/source-workbench-types";
import { cn } from "@/lib/utils/cn";

type SourceMappingWorkbenchProps = {
  savedViews: SavedView[];
  workbench: SourcePropertyWorkbench;
};

type WorkbenchFilters = {
  classificationStatuses: SourceMappingClassificationStatus[];
  confidence: "" | "low";
  documentRole: string;
  entityType: string;
  sourceDatabase: string;
};

const SOURCE_MAPPING_COLUMNS: CollectionColumnDefinition[] = [
  { key: "sourceProperty", label: "원본 컬럼", defaultVisible: true },
  { key: "classification", label: "판정", defaultVisible: true },
  { key: "target", label: "표준 속성", defaultVisible: true },
  { key: "scope", label: "출처 범위", defaultVisible: true },
  { key: "usage", label: "사용량", defaultVisible: true },
  { key: "sample", label: "샘플 값", defaultVisible: true },
  { key: "control", label: "규칙", defaultVisible: true },
];

const STATUS_LABELS: Record<SourceMappingClassificationStatus, string> = {
  hidden: "숨김/노이즈",
  suggested: "적용 후보",
  unmapped: "검토 필요",
};

const STATUS_OPTIONS: Array<{ value: SourceMappingClassificationStatus; label: string; icon: typeof Check }> = [
  { value: "unmapped", label: "검토 필요", icon: AlertCircle },
  { value: "suggested", label: "적용 후보", icon: Check },
  { value: "hidden", label: "숨김/노이즈", icon: EyeOff },
];

export function SourceMappingWorkbench({ savedViews, workbench }: SourceMappingWorkbenchProps) {
  const searchParams = useSearchParams();
  const [workbenchState, setWorkbenchState] = useState(workbench);
  const [localSavedViews, setLocalSavedViews] = useState(savedViews);
  const [activeViewKeyState, setActiveViewKeyState] = useState(() => searchParams.get("view") ?? getDefaultSavedViewKey(savedViews) ?? "needs-review");
  const activeView = localSavedViews.find((view) => getSavedViewKey(view) === activeViewKeyState) ?? localSavedViews.find((view) => view.isDefault) ?? localSavedViews[0];
  const activeViewKey = getSavedViewKey(activeView) ?? activeViewKeyState;
  const [query, setQuery] = useState(() => activeView?.searchQuery ?? "");
  const [filters, setFilters] = useState<WorkbenchFilters>(() => filtersFromSavedView(activeView));
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => savedViewColumnKeys(activeView?.sortState.columns, SOURCE_MAPPING_COLUMNS));
  const [viewManagerOpen, setViewManagerOpen] = useState(false);
  const [viewRenameDrafts, setViewRenameDrafts] = useState<Record<string, string>>({});
  const [viewMutationId, setViewMutationId] = useState<string | null>(null);
  const [mappingMutationId, setMappingMutationId] = useState<string | null>(null);
  const [applyMutationId, setApplyMutationId] = useState<string | null>(null);
  const [applyResults, setApplyResults] = useState<Record<string, SourcePropertyBatchApplyResult>>({});
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setWorkbenchState(workbench);
  }, [workbench]);

  useEffect(() => {
    setLocalSavedViews(savedViews);
  }, [savedViews]);

  const filteredRows = useMemo(
    () =>
      workbenchState.rows.filter((row) => {
        if (filters.classificationStatuses.length && !filters.classificationStatuses.includes(row.classification.status)) return false;
        if (filters.confidence === "low" && row.classification.confidence >= 0.7) return false;
        if (filters.documentRole && row.documentRole !== filters.documentRole) return false;
        if (filters.entityType && row.canonicalEntityType !== filters.entityType) return false;
        if (filters.sourceDatabase && row.sourceDatabase !== filters.sourceDatabase) return false;
        if (query && !sourcePropertySearchText(row).includes(query.toLowerCase())) return false;
        return true;
      }),
    [filters, query, workbenchState.rows],
  );

  function setWorkbenchLocation(viewKey: string) {
    const params = new URLSearchParams({ view: viewKey });
    window.history.pushState(null, "", `/settings/data/source-mapping?${params.toString()}`);
  }

  function selectSavedView(viewKey: string, view: SavedView) {
    setActiveViewKeyState(viewKey);
    setQuery(view.searchQuery);
    setFilters(filtersFromSavedView(view));
    setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, SOURCE_MAPPING_COLUMNS));
    setWorkbenchLocation(viewKey);
  }

  function buildSavedViewPayload(name?: string) {
    return {
      domain: "sources",
      scope: "qa",
      name: name ?? activeView?.name ?? "원본 컬럼 뷰",
      icon: activeView?.icon ?? "map",
      searchQuery: query.trim(),
      filterState: filtersToSavedView(filters),
      sortState: { ...(activeView?.sortState ?? {}), columns: visibleColumnKeys },
    };
  }

  async function createSavedViewFromCurrent(defaultName?: string) {
    const name = defaultName ?? window.prompt("저장할 원본 컬럼 뷰 이름", query.trim() || activeView?.name || "원본 컬럼 뷰");
    if (!name?.trim()) return;
    try {
      const viewKey = `${slugifySavedViewKey(name, "source-mapping-view")}-${Date.now().toString(36)}`;
      const views = await createSavedViewClient({
        ...buildSavedViewPayload(name),
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setWorkbenchLocation(viewKey);
      toast.success("원본 컬럼 뷰를 저장했습니다.");
    } catch (error) {
      toast.error("원본 컬럼 뷰 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  }

  async function patchSavedView(view: SavedView, input: Partial<SavedView>, successMessage: string) {
    if (!isPersistedSavedView(view)) return;
    setViewMutationId(view.id);
    try {
      const views = await updateSavedViewClient(view.id, {
        name: input.name ?? view.name,
        icon: input.icon === undefined ? view.icon : input.icon,
        searchQuery: input.searchQuery ?? view.searchQuery,
        filterState: input.filterState ?? view.filterState,
        sortState: input.sortState ?? view.sortState,
        viewKey: input.viewKey ?? getSavedViewKey(view),
        isDefault: input.isDefault ?? view.isDefault,
        displayOrder: input.displayOrder ?? view.displayOrder,
      });
      setLocalSavedViews(views);
      toast.success(successMessage);
    } catch (error) {
      toast.error("원본 컬럼 뷰 업데이트에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  async function renameSavedView(view: SavedView) {
    const nextName = (viewRenameDrafts[view.id] ?? view.name).trim();
    if (!nextName || nextName === view.name) return;
    await patchSavedView(view, { name: nextName }, "뷰 이름을 바꿨습니다.");
  }

  async function overwriteSavedView(view: SavedView) {
    if (!isPersistedSavedView(view)) return;
    const nextName = (viewRenameDrafts[view.id] ?? view.name).trim() || view.name;
    await patchSavedView(
      view,
      {
        ...buildSavedViewPayload(nextName),
        viewKey: getSavedViewKey(view),
        isDefault: view.isDefault,
        displayOrder: view.displayOrder,
      },
      "현재 조건으로 원본 컬럼 뷰를 바꿨습니다.",
    );
  }

  async function makeSavedViewDefault(view: SavedView) {
    await patchSavedView(view, { isDefault: true }, "기본 뷰로 설정했습니다.");
  }

  async function duplicateSavedView(view: SavedView) {
    const name = (viewRenameDrafts[view.id] ?? `${view.name} 복사본`).trim() || `${view.name} 복사본`;
    const viewKey = `${slugifySavedViewKey(name, "source-mapping-view")}-${Date.now().toString(36)}`;
    setViewMutationId(view.id);
    try {
      const views = await createSavedViewClient({
        domain: view.domain,
        scope: view.scope,
        name,
        icon: view.icon ?? "map",
        searchQuery: view.searchQuery,
        filterState: view.filterState,
        sortState: view.sortState,
        viewKey,
        displayOrder: localSavedViews.length,
      });
      setLocalSavedViews(views);
      setActiveViewKeyState(viewKey);
      setQuery(view.searchQuery);
      setFilters(filtersFromSavedView(view));
      setVisibleColumnKeys(savedViewColumnKeys(view.sortState.columns, SOURCE_MAPPING_COLUMNS));
      setWorkbenchLocation(viewKey);
      toast.success("원본 컬럼 뷰를 편집본으로 복제했습니다.");
    } catch (error) {
      toast.error("원본 컬럼 뷰 복제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  async function deleteSavedView(view: SavedView) {
    if (!isPersistedSavedView(view)) return;
    if (!window.confirm(`${view.name} 뷰를 삭제할까요?`)) return;
    setViewMutationId(view.id);
    try {
      await deleteSavedViewClient(view.id);
      const nextViews = localSavedViews.filter((item) => item.id !== view.id);
      setLocalSavedViews(nextViews);
      const nextView = nextViews.find((item) => item.isDefault) ?? nextViews[0];
      if (nextView) {
        selectSavedView(getSavedViewKey(nextView) ?? nextView.id, nextView);
      }
      toast.success("원본 컬럼 뷰를 삭제했습니다.");
    } catch (error) {
      toast.error("원본 컬럼 뷰 삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setViewMutationId(null);
    }
  }

  async function saveMappingRule(row: SourceWorkbenchProperty, status: SourcePropertyMappingRuleStatus) {
    const selectedTarget = targetDrafts[row.id] ?? defaultTargetValue(row);
    setMappingMutationId(`${row.id}:${status}`);
    try {
      const response = await fetch("/api/source-property-mappings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDatabase: row.sourceDatabase,
          canonicalEntityType: row.canonicalEntityType,
          propertyName: row.propertyName,
          propertyType: row.propertyType,
          documentRole: row.documentRole,
          documentStatus: row.documentStatus,
          status,
          targetField: status === "mapped" ? selectedTarget : null,
          displayLabel: status === "mapped" ? row.targetOptions.find((option) => option.value === selectedTarget)?.label : row.classification.displayName,
          confidence: status === "needs_review" ? 0.2 : 1,
        }),
      });
      const payload = (await response.json()) as { workbench?: SourcePropertyWorkbench; error?: string };
      if (!response.ok || !payload.workbench) {
        throw new Error(payload.error ?? "매핑 규칙 저장에 실패했습니다.");
      }
      setWorkbenchState(payload.workbench);
      toast.success(status === "mapped" ? "원본 컬럼 매핑을 저장했습니다." : status === "hidden" ? "원본 컬럼을 숨김 규칙으로 저장했습니다." : "원본 컬럼을 검토 대상으로 표시했습니다.");
    } catch (error) {
      toast.error("원본 컬럼 규칙 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : "마이그레이션 적용 상태를 확인해 주세요.",
      });
    } finally {
      setMappingMutationId(null);
    }
  }

  async function applyMappingRule(row: SourceWorkbenchProperty) {
    const selectedTarget = targetDrafts[row.id] ?? defaultTargetValue(row);
    if (!selectedTarget) return;
    setApplyMutationId(row.id);
    try {
      const response = await fetch("/api/source-property-mappings/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDatabase: row.sourceDatabase,
          canonicalEntityType: row.canonicalEntityType,
          propertyName: row.propertyName,
          propertyType: row.propertyType,
          documentRole: row.documentRole,
          documentStatus: row.documentStatus,
          targetField: selectedTarget,
          overwrite: false,
        }),
      });
      const payload = (await response.json()) as {
        result?: SourcePropertyBatchApplyResult;
        workbench?: SourcePropertyWorkbench;
        error?: string;
      };
      if (!response.ok || !payload.result || !payload.workbench) {
        throw new Error(payload.error ?? "원본 컬럼 일괄 적용에 실패했습니다.");
      }
      const { result } = payload;
      setWorkbenchState(payload.workbench);
      setApplyResults((current) => ({ ...current, [row.id]: result }));
      toast.success(`빈 표준 속성 ${result.applied}건에 적용했습니다.`, {
        description: `대상 ${result.matchedDocuments}건 · 기존 값 유지 ${result.skippedExisting}건 · 건너뜀 ${result.skippedInvalid + result.skippedUnlinked}건`,
      });
    } catch (error) {
      toast.error("원본 컬럼 일괄 적용에 실패했습니다.", {
        description: error instanceof Error ? error.message : "매핑 대상과 표준 엔티티를 확인해 주세요.",
      });
    } finally {
      setApplyMutationId(null);
    }
  }

  const visibleColumnSet = new Set(visibleColumnKeys);

  return (
    <CollectionShell
      description="Notion에서 넘어온 원본 컬럼을 표준 속성 registry와 비교하고, 사용자별 매핑/숨김/검토 규칙으로 승격합니다."
      eyebrow="Data Settings"
      metrics={[
        { label: "전체 컬럼", value: workbenchState.summary.totalProperties },
        { label: "적용 후보", value: workbenchState.summary.suggested },
        { label: "검토 필요", value: workbenchState.summary.unmapped },
        { label: "리뷰 항목", value: workbenchState.summary.openReviewItems },
        { label: "저장 규칙", value: workbenchState.summary.overrideRules },
      ]}
      title="원본 컬럼 정리"
      toolbar={
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SavedViewTabs activeViewKey={activeViewKey} basePath="/settings/data/source-mapping" onSelect={selectSavedView} views={localSavedViews} />
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-white/8"
              onClick={() => setViewManagerOpen((open) => !open)}
              type="button"
            >
              <Settings2 className="h-4 w-4" />
              뷰 관리
            </button>
            <button
              className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/15"
              onClick={() => createSavedViewFromCurrent()}
              type="button"
            >
              <Save className="h-4 w-4" />
              현재 조건 저장
            </button>
            <CollectionColumnControls columns={SOURCE_MAPPING_COLUMNS} onChange={setVisibleColumnKeys} visibleKeys={visibleColumnKeys} />
          </div>
          {viewManagerOpen ? (
            <SavedViewManager
              activeViewKey={activeViewKey}
              createCurrentLabel="현재 조건 새 뷰"
              mutationId={viewMutationId}
              onCreateCurrent={() => createSavedViewFromCurrent()}
              onDelete={deleteSavedView}
              onDuplicate={duplicateSavedView}
              onMakeDefault={makeSavedViewDefault}
              onOverwrite={overwriteSavedView}
              onRename={renameSavedView}
              onRenameDraftChange={(viewId, name) => setViewRenameDrafts((current) => ({ ...current, [viewId]: name }))}
              renameDrafts={viewRenameDrafts}
              title="원본 컬럼 뷰 편집"
              views={localSavedViews}
            />
          ) : null}
        </div>
      }
    >
      <GlassCard className="grid gap-4" priority="primary">
        <SourceMappingFilters
          documentRoles={workbenchState.filters.documentRoles}
          entityTypes={workbenchState.filters.entityTypes}
          filters={filters}
          onChange={setFilters}
          onQueryChange={setQuery}
          query={query}
          resultCount={filteredRows.length}
          sourceDatabases={workbenchState.filters.sourceDatabases}
        />

        {filteredRows.length ? (
          <div className="grid gap-2">
            {filteredRows.map((row) => (
              <SourceMappingRow
                key={row.id}
                mappingBusy={mappingMutationId}
                onSaveRule={saveMappingRule}
                onApplyRule={applyMappingRule}
                onTargetChange={(target) => setTargetDrafts((current) => ({ ...current, [row.id]: target }))}
                applyBusy={applyMutationId}
                applyResult={applyResults[row.id]}
                row={row}
                targetValue={targetDrafts[row.id] ?? defaultTargetValue(row)}
                visibleColumnSet={visibleColumnSet}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-white/15 bg-black/10 p-6 text-center text-sm text-muted-foreground">
            현재 조건에 맞는 원본 컬럼이 없습니다.
          </div>
        )}
      </GlassCard>
    </CollectionShell>
  );
}

function SourceMappingFilters({
  documentRoles,
  entityTypes,
  filters,
  onChange,
  onQueryChange,
  query,
  resultCount,
  sourceDatabases,
}: {
  documentRoles: string[];
  entityTypes: string[];
  filters: WorkbenchFilters;
  onChange: (filters: WorkbenchFilters) => void;
  onQueryChange: (query: string) => void;
  query: string;
  resultCount: number;
  sourceDatabases: string[];
}) {
  function toggleStatus(status: SourceMappingClassificationStatus) {
    const selected = filters.classificationStatuses.includes(status);
    onChange({
      ...filters,
      classificationStatuses: selected
        ? filters.classificationStatuses.filter((item) => item !== status)
        : [...filters.classificationStatuses, status],
    });
  }

  return (
    <div className="grid gap-3 rounded-md border border-white/10 bg-black/10 p-3">
      <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_auto]">
        <input
          className="input-base min-h-10 py-0 text-sm"
          inputMode="search"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="원본 컬럼, 표준 속성, 샘플 값 검색"
          value={query}
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Map className="h-4 w-4 text-primary" />
          {resultCount}개 표시
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = filters.classificationStatuses.includes(option.value);
          return (
            <button
              className={cn(
                "focus-ring inline-flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-xs transition",
                active ? "border-primary/25 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/8 hover:text-foreground",
              )}
              key={option.value}
              onClick={() => toggleStatus(option.value)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              {option.label}
            </button>
          );
        })}
        <label className="flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground">
          <Gauge className="h-4 w-4" />
          신뢰도
          <select
            className="bg-transparent text-foreground outline-none"
            onChange={(event) => onChange({ ...filters, confidence: event.target.value === "low" ? "low" : "" })}
            value={filters.confidence}
          >
            <option value="">전체</option>
            <option value="low">낮음</option>
          </select>
        </label>
        <FilterSelect
          label="원본 DB"
          onChange={(sourceDatabase) => onChange({ ...filters, sourceDatabase })}
          options={sourceDatabases}
          value={filters.sourceDatabase}
        />
        <FilterSelect
          label="엔티티"
          onChange={(entityType) => onChange({ ...filters, entityType })}
          options={entityTypes}
          value={filters.entityType}
        />
        <FilterSelect
          label="문서 역할"
          onChange={(documentRole) => onChange({ ...filters, documentRole })}
          options={documentRoles}
          value={filters.documentRole}
        />
        <button
          className="focus-ring min-h-9 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground"
          onClick={() => {
            onQueryChange("");
            onChange(emptyFilters());
          }}
          type="button"
        >
          필터 초기화
        </button>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  if (!options.length) return null;
  return (
    <label className="flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground">
      {label}
      <select className="max-w-44 bg-transparent text-foreground outline-none" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">전체</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatEntityValue(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SourceMappingRow({
  applyBusy,
  applyResult,
  mappingBusy,
  onApplyRule,
  onSaveRule,
  onTargetChange,
  row,
  targetValue,
  visibleColumnSet,
}: {
  applyBusy: string | null;
  applyResult?: SourcePropertyBatchApplyResult;
  mappingBusy: string | null;
  onApplyRule: (row: SourceWorkbenchProperty) => void;
  onSaveRule: (row: SourceWorkbenchProperty, status: SourcePropertyMappingRuleStatus) => void;
  onTargetChange: (target: string) => void;
  row: SourceWorkbenchProperty;
  targetValue: string;
  visibleColumnSet: Set<string>;
}) {
  const busy = mappingBusy?.startsWith(`${row.id}:`) ?? false;
  const applying = applyBusy === row.id;
  return (
    <article className="grid gap-3 rounded-md border border-white/10 bg-white/5 p-3 xl:grid-cols-[minmax(190px,1.1fr)_150px_minmax(170px,0.9fr)_minmax(150px,0.9fr)_120px_minmax(180px,1fr)_minmax(240px,1.2fr)]">
      {visibleColumnSet.has("sourceProperty") ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{row.propertyName}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatPropertyType(row.propertyType)}</p>
          {row.overrideRule ? <p className="mt-2 text-[11px] text-primary">사용자 규칙 적용됨</p> : null}
          {row.review.openCount ? <p className="mt-1 text-[11px] text-amber-200">리뷰 {row.review.openCount}건 열림</p> : null}
        </div>
      ) : null}
      {visibleColumnSet.has("classification") ? (
        <div className="min-w-0">
          <StatusBadge status={row.classification.status} />
          <p className="mt-2 text-xs text-muted-foreground">신뢰도 {Math.round(row.classification.confidence * 100)}%</p>
        </div>
      ) : null}
      {visibleColumnSet.has("target") ? (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">표준 라벨</p>
          <p className="mt-1 truncate text-sm text-foreground">{row.classification.displayName}</p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{row.classification.targetValue === "skip" ? "매핑 안 함" : row.classification.targetValue}</p>
        </div>
      ) : null}
      {visibleColumnSet.has("scope") ? (
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="truncate text-foreground">{row.sourceDatabase ?? "원본 DB 미상"}</p>
          <p className="mt-1">{formatEntityValue(row.canonicalEntityType ?? "엔티티 미상")}</p>
          <p className="mt-1">{formatDocumentStatus(row.documentStatus)} · {formatEntityValue(row.documentRole ?? "역할 미상")}</p>
        </div>
      ) : null}
      {visibleColumnSet.has("usage") ? (
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="text-lg font-semibold text-foreground">{row.occurrences}</p>
          <p>{row.documentCount}개 문서</p>
        </div>
      ) : null}
      {visibleColumnSet.has("sample") ? (
        <div className="min-w-0">
          <p className="line-clamp-3 break-words text-xs leading-5 text-muted-foreground">{row.sampleValue ?? "샘플 값 없음"}</p>
          <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground/80">{row.classification.reason}</p>
        </div>
      ) : null}
      {visibleColumnSet.has("control") ? (
        <div className="grid gap-2">
          <select
            aria-label={`${row.propertyName} 매핑 대상`}
            className="input-base h-10 py-0 text-xs"
            onChange={(event) => onTargetChange(event.target.value)}
            value={targetValue}
          >
            {row.targetOptions.map((option) => (
              <option key={`${option.group}:${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !targetValue}
              onClick={() => onSaveRule(row, "mapped")}
              type="button"
            >
              <Check className="h-4 w-4" />
              매핑
            </button>
            <button
              className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => onSaveRule(row, "needs_review")}
              type="button"
            >
              <AlertCircle className="h-4 w-4" />
              검토
            </button>
            <button
              className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs text-muted-foreground transition hover:bg-white/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={() => onSaveRule(row, "hidden")}
              type="button"
            >
              <EyeOff className="h-4 w-4" />
              숨김
            </button>
          </div>
          <button
            className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || applying || !targetValue || !row.canonicalEntityType}
            onClick={() => onApplyRule(row)}
            title="기존 canonical 값은 유지하고 빈 값에만 적용합니다."
            type="button"
          >
            <UploadCloud className="h-4 w-4" />
            {applying ? "적용 중" : "빈 값 적용"}
          </button>
          {applyResult ? (
            <p className="text-[11px] leading-5 text-muted-foreground">
              적용 {applyResult.applied}건 · 기존 값 유지 {applyResult.skippedExisting}건 · 제외 {applyResult.skippedInvalid + applyResult.skippedUnlinked + applyResult.unsupported}건
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function StatusBadge({ status }: { status: SourceMappingClassificationStatus }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-[11px]",
        status === "suggested" && "border-primary/25 bg-primary/10 text-primary",
        status === "unmapped" && "border-amber-300/25 bg-amber-300/10 text-amber-200",
        status === "hidden" && "border-white/10 bg-black/10 text-muted-foreground",
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function filtersFromSavedView(view: SavedView | null | undefined): WorkbenchFilters {
  const filterState = view?.filterState ?? {};
  return {
    classificationStatuses: statusArray(filterState.classificationStatus ?? filterState.status),
    confidence: filterState.confidence === "low" ? "low" : "",
    documentRole: firstFilterValue(filterState.documentRole),
    entityType: firstFilterValue(filterState.canonicalEntityType),
    sourceDatabase: firstFilterValue(filterState.sourceDatabase),
  };
}

function filtersToSavedView(filters: WorkbenchFilters) {
  const filterState: Record<string, unknown> = {};
  if (filters.classificationStatuses.length) filterState.classificationStatus = filters.classificationStatuses;
  if (filters.confidence) filterState.confidence = filters.confidence;
  if (filters.documentRole) filterState.documentRole = [filters.documentRole];
  if (filters.entityType) filterState.canonicalEntityType = [filters.entityType];
  if (filters.sourceDatabase) filterState.sourceDatabase = [filters.sourceDatabase];
  return filterState;
}

function statusArray(value: unknown): SourceMappingClassificationStatus[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .map((item) => {
      if (item === "needs_review") return "unmapped";
      if (item === "mapped") return "suggested";
      if (item === "ignored") return "hidden";
      return item;
    })
    .filter((item): item is SourceMappingClassificationStatus => item === "suggested" || item === "unmapped" || item === "hidden");
}

function firstFilterValue(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function emptyFilters(): WorkbenchFilters {
  return {
    classificationStatuses: [],
    confidence: "",
    documentRole: "",
    entityType: "",
    sourceDatabase: "",
  };
}

function defaultTargetValue(row: SourceWorkbenchProperty) {
  if (row.classification.targetValue !== "skip") return row.classification.targetValue;
  return row.targetOptions[0]?.value ?? "";
}

function sourcePropertySearchText(row: SourceWorkbenchProperty) {
  return [
    row.propertyName,
    row.propertyType,
    row.sourceDatabase,
    row.canonicalEntityType,
    row.documentRole,
    row.sampleValue,
    row.classification.displayName,
    row.classification.targetValue,
    row.classification.reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatPropertyType(type: string | null) {
  if (!type) return "타입 미상";
  const normalized = type.toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  if (normalized.includes("multi")) return "다중 선택";
  if (normalized.includes("select")) return "선택";
  if (normalized.includes("date")) return "날짜";
  if (normalized.includes("url")) return "URL";
  if (normalized.includes("checkbox") || normalized.includes("boolean")) return "체크";
  if (normalized.includes("number")) return "숫자";
  if (normalized.includes("title")) return "제목";
  if (normalized.includes("text") || normalized.includes("rich")) return "텍스트";
  return type;
}

function formatDocumentStatus(status: string) {
  if (status === "mapped") return "매핑됨";
  if (status === "active") return "활성";
  if (status === "needs_review") return "검토 필요";
  if (status === "archived") return "보관";
  return status;
}

function formatEntityValue(value: string) {
  const labels: Record<string, string> = {
    archive_work: "보관 작업",
    asset: "자산",
    career: "커리어",
    daily_entry: "일일 기록",
    daily_log: "일일 로그",
    daily_log_entry: "일일 기록",
    habit: "습관",
    media: "미디어",
    person: "사람",
    place: "장소",
    project: "프로젝트",
    task: "작업",
    workout: "운동",
    zettel: "제텔",
  };
  return labels[value] ?? value;
}
