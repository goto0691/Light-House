export type LabPrivacyLevel = "normal" | "sensitive" | "restricted";

export type LabRecord = Readonly<{
  id: string;
  title: string;
  snippet: string;
  secondarySnippet?: string;
  typeLabel: string;
  iconKey: string;
  date: string;
  writtenDate: string;
  rating?: number;
  tags: readonly string[];
  privacyLevel: LabPrivacyLevel;
}>;

export const labRecords: readonly LabRecord[] = [
  {
    id: "place-yeonnam",
    title: "모모식당 연남점",
    snippet: "가지튀김이 특히 맛있었다.",
    secondarySnippet: "데이트하러 오기 좋은 조용한 분위기.",
    typeLabel: "장소 방문",
    iconKey: "type.place",
    date: "2026. 08. 10",
    writtenDate: "2026년 8월 10일",
    rating: 4.5,
    tags: ["가지튀김", "데이트"],
    privacyLevel: "normal",
  },
  {
    id: "film-late-bloom",
    title: "늦게 피는 이야기",
    snippet: "담담한 연출이 인상적이었다.",
    secondarySnippet: "관계의 결을 조용히 보여주는 영화.",
    typeLabel: "영화 감상",
    iconKey: "type.movie",
    date: "2026. 08. 08",
    writtenDate: "2026년 8월 8일",
    rating: 4,
    tags: ["드라마"],
    privacyLevel: "normal",
  },
  {
    id: "workout-morning-5k",
    title: "5km 아침 달리기",
    snippet: "날씨가 선선해서 페이스 유지가 좋았다.",
    secondarySnippet: "기분 전환에 최고.",
    typeLabel: "운동 기록",
    iconKey: "type.workout",
    date: "2026. 08. 06",
    writtenDate: "2026년 8월 6일",
    tags: ["러닝", "아침 루틴"],
    privacyLevel: "normal",
  },
  {
    id: "essay-memory-place",
    title: "기억은 장소를 따라간다",
    snippet: "장소는 감정을 저장하는 그릇이다.",
    secondarySnippet: "기억의 지도 위에 나의 궤적을 그린다.",
    typeLabel: "에세이",
    iconKey: "type.essay",
    date: "2026. 08. 03",
    writtenDate: "2026년 8월 3일",
    tags: ["글쓰기"],
    privacyLevel: "sensitive",
  },
  {
    id: "book-quote-life",
    title: "인상 깊었던 한 문장",
    snippet: "삶은 자신이 좋아하는 것들을 향해 조용히 이동하는 것이다.",
    typeLabel: "독서 기록",
    iconKey: "type.book",
    date: "2026. 07. 29",
    writtenDate: "2026년 7월 29일",
    tags: ["문장 수집", "자기계발"],
    privacyLevel: "normal",
  },
];

export const initialLabRecord = labRecords[0];
