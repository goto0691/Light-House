/** The Korean names the editor shows for a record's 공개 범위 and 문서 상태, for every other screen. */
const PRIVACY_LABELS: Readonly<Record<string, string>> = { normal: "일반", sensitive: "민감", restricted: "잠금" };
const DOCUMENT_STATUS_LABELS: Readonly<Record<string, string>> = { inbox: "받은 기록", draft: "초안", revising: "다듬는 중", finished: "완성", archived: "보관" };

const ENTITY_KIND_LABELS: Readonly<Record<string, string>> = { person: "사람", work: "작품", place: "장소", organization: "단체", book: "책", game: "게임", platform: "플랫폼" };

export function privacyLabel(level: string) { return PRIVACY_LABELS[level] ?? level; }
export function entityKindLabel(kind: string) { return ENTITY_KIND_LABELS[kind] ?? kind; }
export function documentStatusLabel(status: string | null) { return status ? DOCUMENT_STATUS_LABELS[status] ?? status : ""; }
