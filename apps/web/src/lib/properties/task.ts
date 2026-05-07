import type { PropertyDefinition, PropertyGroupDefinition, PropertyOption } from "./types";

export const TASK_KIND_OPTIONS: PropertyOption[] = [
  { value: "development", label: "개발" },
  { value: "writing", label: "집필" },
  { value: "research", label: "리서치" },
];

export const TASK_STATUS_OPTIONS: PropertyOption[] = [
  { value: "todo", label: "예정" },
  { value: "in_progress", label: "진행 중" },
  { value: "review", label: "검토" },
  { value: "done", label: "완료" },
  { value: "blocked", label: "막힘" },
];

export const TASK_PRIORITY_OPTIONS: PropertyOption[] = [
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
];

export const TASK_BRAIN_ENERGY_OPTIONS: PropertyOption[] = [
  { value: "hyper_focus", label: "고집중" },
  { value: "normal", label: "보통" },
  { value: "routine", label: "루틴" },
];

export const TASK_PROPERTY_GROUPS: PropertyGroupDefinition[] = [
  { key: "identity", label: "기본 정보", defaultOpen: true },
  { key: "classification", label: "분류", defaultOpen: true },
  { key: "status", label: "상태와 우선순위", defaultOpen: true },
  { key: "dates", label: "일정", defaultOpen: true },
  { key: "review", label: "작업 메모", defaultOpen: false },
];

export const TASK_PROPERTY_DEFINITIONS: PropertyDefinition[] = [
  {
    key: "task.title",
    entityType: "task",
    field: "title",
    label: "제목",
    group: "identity",
    valueType: "text",
    display: "text",
    defaultVisibleInList: true,
    defaultVisibleInDetail: true,
    sourceAliases: ["title", "name", "task", "제목", "이름", "작업"],
  },
  {
    key: "task.kind",
    entityType: "task",
    field: "kind",
    label: "작업 유형",
    group: "classification",
    valueType: "select",
    display: "segmented",
    options: TASK_KIND_OPTIONS,
    defaultVisibleInList: true,
    defaultVisibleInDetail: true,
    sourceAliases: ["kind", "type", "작업 유형", "유형", "종류"],
  },
  {
    key: "task.status",
    entityType: "task",
    field: "status",
    label: "상태",
    group: "status",
    valueType: "select",
    display: "segmented",
    options: TASK_STATUS_OPTIONS,
    defaultVisibleInList: true,
    defaultVisibleInDetail: true,
    sourceAliases: ["status", "state", "상태", "진행 상태"],
  },
  {
    key: "task.priority",
    entityType: "task",
    field: "priority",
    label: "우선순위",
    group: "status",
    valueType: "select",
    display: "segmented",
    options: TASK_PRIORITY_OPTIONS,
    defaultVisibleInList: true,
    defaultVisibleInDetail: true,
    sourceAliases: ["priority", "importance", "우선순위", "중요도"],
  },
  {
    key: "task.brainEnergy",
    entityType: "task",
    field: "brainEnergy",
    label: "필요 에너지",
    group: "status",
    valueType: "select",
    display: "segmented",
    options: TASK_BRAIN_ENERGY_OPTIONS,
    defaultVisibleInList: true,
    defaultVisibleInDetail: true,
    sourceAliases: ["energy", "brain energy", "에너지", "집중도"],
  },
  {
    key: "task.dueAt",
    entityType: "task",
    field: "dueAt",
    label: "마감일",
    group: "dates",
    valueType: "date",
    display: "date",
    allowEmpty: true,
    defaultVisibleInList: true,
    defaultVisibleInDetail: true,
    sourceAliases: ["due", "due date", "deadline", "마감", "마감일"],
  },
  {
    key: "task.content",
    entityType: "task",
    field: "content",
    label: "작업 메모",
    group: "review",
    valueType: "longText",
    display: "textarea",
    defaultVisibleInDetail: true,
    sourceAliases: ["content", "memo", "notes", "description", "메모", "설명", "본문"],
  },
];
