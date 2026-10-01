import type { TemplateDefinitionV1 } from "@/lib/v2/templates/template-definition-v1";

export type SystemTemplateSeed = Readonly<{ key: string; iconKey: string; definition: TemplateDefinitionV1 }>;

export const SYSTEM_TEMPLATE_SEEDS: readonly SystemTemplateSeed[] = [
  {
    key: "review",
    iconKey: "type.review",
    definition: {
      contractVersion: 1,
      name: "리뷰 기록",
      description: "작품이나 경험의 사실보다 먼저, 나에게 남은 기억을 기록하도록 돕습니다.",
      expectedTypeIds: ["review"],
      objectRoles: [{ role: "primary_document", optional: false }, { role: "subject_entity", optional: true }, { role: "experience_event", optional: true }],
      sections: [
        { key: "memory", label: "먼저 떠올릴 것", items: [
          { key: "subject_name", kind: "field", prompt: "어떤 작품이나 경험이었나요?", prominence: "core", binding: { ownerRole: "primary_document", fieldKey: "subject_name" }, inputKind: "text", cardinality: "one", allowedAiOperations: ["extract_from_capture", "resolve_entity"] },
          { key: "experienced_at", kind: "core", prompt: "언제 경험했나요?", prominence: "core", binding: { ownerRole: "primary_document", corePath: "document.written_at" }, inputKind: "date", cardinality: "one", allowedAiOperations: ["extract_from_capture"] },
          { key: "companions", kind: "field", prompt: "함께한 사람이 있었나요? 혼자였다면 비워두세요.", prominence: "core", binding: { ownerRole: "primary_document", fieldKey: "companions" }, inputKind: "person_picker", cardinality: "many", allowedAiOperations: ["extract_from_capture"] },
          { key: "user_rating", kind: "field", prompt: "지금 남아 있는 평점은 몇 점인가요?", helperText: "0점부터 5점 사이에서 반 점 단위로 남길 수 있습니다.", prominence: "core", binding: { ownerRole: "primary_document", fieldKey: "user_rating" }, inputKind: "rating", cardinality: "one", allowedAiOperations: ["extract_from_capture"] },
        ] },
        { key: "recall", label: "더 떠올려보기", items: [
          { key: "memorable_point", kind: "recall_cue", prompt: "가장 기억에 남은 장면·문장·맛은 무엇인가요?", prominence: "suggested", allowedAiOperations: ["none"] },
          { key: "recommendation_context", kind: "recall_cue", prompt: "어떤 사람이나 상황에 권하고 싶은가요?", prominence: "optional", allowedAiOperations: ["none"] },
        ] },
      ],
    },
  },
  {
    key: "workout",
    iconKey: "type.workout",
    definition: {
      contractVersion: 1,
      name: "운동 기록",
      description: "스크린샷과 함께 기본 수치를 남기고, 몸의 느낌은 자유롭게 적습니다.",
      expectedTypeIds: ["workout_log"],
      objectRoles: [{ role: "primary_document", optional: false }, { role: "experience_event", optional: true }],
      sections: [
        { key: "metrics", label: "운동 수치", items: [
          { key: "workout_date", kind: "core", prompt: "언제 운동했나요?", prominence: "core", binding: { ownerRole: "primary_document", corePath: "document.written_at" }, inputKind: "date", cardinality: "one", allowedAiOperations: ["extract_from_capture"] },
          { key: "distance_km", kind: "field", prompt: "기록할 거리가 있나요?", helperText: "킬로미터 단위", prominence: "core", binding: { ownerRole: "primary_document", fieldKey: "distance_km" }, inputKind: "measurement", cardinality: "one", allowedAiOperations: ["extract_from_capture"] },
          { key: "duration_min", kind: "field", prompt: "운동 시간은 몇 분이었나요?", prominence: "core", binding: { ownerRole: "primary_document", fieldKey: "duration_min" }, inputKind: "measurement", cardinality: "one", allowedAiOperations: ["extract_from_capture"] },
          { key: "average_heart_rate", kind: "field", prompt: "평균 심박을 남길까요?", helperText: "분당 심박수", prominence: "suggested", binding: { ownerRole: "primary_document", fieldKey: "average_heart_rate" }, inputKind: "measurement", cardinality: "one", allowedAiOperations: ["extract_from_capture"] },
        ] },
        { key: "recall", label: "몸의 기억", items: [
          { key: "body_memory", kind: "recall_cue", prompt: "몸에서 가장 먼저 떠오르는 느낌은 무엇인가요?", prominence: "suggested", allowedAiOperations: ["none"] },
        ] },
      ],
    },
  },
] as const;
