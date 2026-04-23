import "server-only";

import { ulid } from "ulidx";

import { getActionHubSnapshot, seedActionHubSupportData } from "@/lib/server/action-hub";
import { executeD1 } from "@/lib/server/cloudflare-d1";
import { createInlineDataPart, generateGeminiJson, generateGeminiText, getGeminiModel, type GeminiExecution } from "@/lib/server/gemini";
import { getLifeOpsLog, seedLifeOpsSupportData } from "@/lib/server/life-ops";
import { getPRMSnapshot, seedPRMSupportData } from "@/lib/server/prm";
import { getAttachmentVariant } from "@/lib/server/r2";
import { resolveCurrentUser } from "@/lib/server/session-user";
import { getVaultSnapshot, seedVaultSupportData } from "@/lib/server/vault";

export type SummaryInput =
  | { type: "daily"; date?: string }
  | { type: "weekly"; date?: string }
  | { type: "project"; id: string };

function formatDateLabel(date: string) {
  return new Date(`${date}T00:00:00+09:00`).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function persistConversation(userId: string, purpose: string, input: string, execution: { markdown: string; model: string; inputTokens: number; outputTokens: number; latencyMs: number }) {
  await executeD1(
    `insert into ai_conversations
      (id, user_id, purpose, input, output, model, input_tokens, output_tokens, latency_ms, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      ulid(),
      userId,
      purpose,
      input,
      execution.markdown,
      execution.model,
      execution.inputTokens,
      execution.outputTokens,
      execution.latencyMs,
    ],
  );
}

function localExecution(markdown: string): GeminiExecution & { markdown: string } {
  return {
    markdown,
    model: "local-template-v1",
    inputTokens: Math.max(1, Math.ceil(markdown.length / 4)),
    outputTokens: Math.max(1, Math.ceil(markdown.length / 4)),
    latencyMs: 1,
    text: markdown,
  };
}

async function summarizeWithGeminiOrFallback(prompt: string, fallbackMarkdown: string): Promise<GeminiExecution & { markdown: string }> {
  try {
    const gemini = await generateGeminiText({
      systemInstruction: "You are the summarization engine for a private productivity system. Return only concise Korean Markdown grounded in the provided data. Do not invent facts.",
      parts: [{ text: prompt }],
      thinkingLevel: "high",
      temperature: 0.4,
    });
    return gemini ? { ...gemini, markdown: gemini.text } : localExecution(fallbackMarkdown);
  } catch {
    return localExecution(fallbackMarkdown);
  }
}

async function buildDailySummary(date: string) {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const [log, actionHub, prm, vault] = await Promise.all([
    getLifeOpsLog(date),
    getActionHubSnapshot(),
    getPRMSnapshot(),
    getVaultSnapshot(),
  ]);

  if (!log) {
    return `# Daily Summary\n\n${formatDateLabel(date)}의 Life Ops 기록이 아직 없습니다.`;
  }

  const overdue = prm.people.filter((person) => person.daysSinceContact > person.cadenceDays).length;
  const activeTasks = actionHub.tasks.filter((task) => ["todo", "in_progress", "review", "blocked"].includes(task.status)).length;

  return [
    `# Daily Summary`,
    ``,
    `## ${formatDateLabel(date)}`,
    `- Mood / Energy: ${log.mood}/5, ${log.energy}/5`,
    `- 완료한 습관: ${log.habits.filter((habit) => habit.completedToday).length} / ${log.habits.length}`,
    `- Deep Work: ${log.deepWorkMinutes}분`,
    `- 연락이 밀린 인물: ${overdue}명`,
    `- 진행 중 Task: ${activeTasks}개`,
    ``,
    `## 오늘의 관찰`,
    `- 감사: ${log.gratitude || "아직 입력되지 않았습니다."}`,
    `- 일기: ${(log.journal || "아직 입력되지 않았습니다.").slice(0, 160)}`,
    `- 묵상: ${(log.meditation || "아직 입력되지 않았습니다.").slice(0, 160)}`,
    ``,
    `## 크로스 도메인 메모`,
    ...log.timeline.map((item) => `- ${item.time} · [${item.type}] ${item.label}`),
    ...(vault.zettels.slice(0, 2).map((zettel) => `- 최근 참고 메모: ${zettel.title}`) || []),
  ].join("\n");
}

async function buildWeeklySummary(referenceDate: string) {
  await Promise.all([seedActionHubSupportData(), seedLifeOpsSupportData(), seedPRMSupportData(), seedVaultSupportData()]);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${referenceDate}T00:00:00+09:00`);
    date.setDate(date.getDate() - index);
    return date.toISOString().slice(0, 10);
  }).reverse();

  const [logs, actionHub, prm, vault] = await Promise.all([
    Promise.all(dates.map((date) => getLifeOpsLog(date))),
    getActionHubSnapshot(),
    getPRMSnapshot(),
    getVaultSnapshot(),
  ]);

  const existingLogs = logs.filter(Boolean);
  const avgMood = existingLogs.length ? (existingLogs.reduce((sum, log) => sum + (log?.mood ?? 0), 0) / existingLogs.length).toFixed(1) : "0.0";
  const avgEnergy = existingLogs.length ? (existingLogs.reduce((sum, log) => sum + (log?.energy ?? 0), 0) / existingLogs.length).toFixed(1) : "0.0";
  const completedHabits = existingLogs.reduce((sum, log) => sum + (log?.habits.filter((habit) => habit.completedToday).length ?? 0), 0);
  const completedTasks = actionHub.tasks.filter((task) => task.status === "done").length;
  const overduePeople = prm.people.filter((person) => person.daysSinceContact > person.cadenceDays).slice(0, 5);

  return [
    `# Weekly Review`,
    ``,
    `## ${dates[0]} ~ ${dates[dates.length - 1]}`,
    `- 평균 Mood: ${avgMood}`,
    `- 평균 Energy: ${avgEnergy}`,
    `- 완료 습관 체크: ${completedHabits}회`,
    `- 완료된 Task 누적: ${completedTasks}개`,
    `- 최근 메모 자산: ${vault.zettels.length}개`,
    ``,
    `## 이번 주 회고`,
    `- 흐름상 Action Hub와 Life Ops가 함께 움직이기 시작했고, 관계/지식/라이프 로그가 하나의 홈 대시보드에서 집계된다.`,
    `- 다음으로 신경 써야 할 것은 연락 overdue 정리와 진행 중 Task의 마무리다.`,
    ``,
    `## Follow-up`,
    ...(overduePeople.length
      ? overduePeople.map((person) => `- ${person.name}: ${person.daysSinceContact}일째 미연락, cadence ${person.cadenceDays}일`)
      : ["- 연락 overdue 인물이 없습니다."]),
  ].join("\n");
}

async function buildProjectSummary(projectId: string) {
  await seedActionHubSupportData();
  const snapshot = await getActionHubSnapshot();
  const project = snapshot.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error("프로젝트를 찾지 못했습니다.");
  }

  const tasks = snapshot.tasks.filter((task) => task.projectId === projectId);
  const done = tasks.filter((task) => task.status === "done").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const inFlight = tasks.filter((task) => ["todo", "in_progress", "review"].includes(task.status)).length;

  return [
    `# Project Summary`,
    ``,
    `## ${project.title}`,
    `- Progress: ${project.progress}%`,
    `- In Flight: ${inFlight}개`,
    `- Done: ${done}개`,
    `- Blocked: ${blocked}개`,
    ``,
    `## 현재 포커스`,
    ...tasks.slice(0, 6).map((task) => `- ${task.title} · ${task.status} · ${task.priority}`),
  ].join("\n");
}

export async function generateAISummary(input: SummaryInput) {
  const user = await resolveCurrentUser();
  const date = "date" in input && input.date ? input.date : getTodayDateString();

  let fallbackMarkdown = "";
  let purpose = "";

  if (input.type === "daily") {
    purpose = `summarize:daily:${date}`;
    fallbackMarkdown = await buildDailySummary(date);
  }

  if (input.type === "weekly") {
    purpose = `summarize:weekly:${date}`;
    fallbackMarkdown = await buildWeeklySummary(date);
  }

  if (input.type === "project") {
    purpose = `summarize:project:${input.id}`;
    fallbackMarkdown = await buildProjectSummary(input.id);
  }

  const prompt = [
    `Target summary type: ${input.type}`,
    `Preferred language: Korean`,
    `Output format: concise markdown`,
    `Model preference: ${getGeminiModel()}`,
    ``,
    `Summarize the following source material without inventing facts:`,
    fallbackMarkdown,
  ].join("\n");

  const execution = await summarizeWithGeminiOrFallback(prompt, fallbackMarkdown);

  if (input.type === "daily") {
    await executeD1(
      `update daily_logs set ai_summary = ?, updated_at = datetime('now') where user_id = ? and date = ?`,
      [execution.markdown, user.id, date],
    );
  }

  await persistConversation(user.id, purpose, JSON.stringify(input), execution);

  return execution.markdown;
}

export async function summarizeAttachmentDocument(input: { attachmentId: string; prompt?: string }) {
  const user = await resolveCurrentUser();
  const document = await getAttachmentVariant(input.attachmentId, "original");
  const fallbackMarkdown = [
    "# Document Summary",
    "",
    `- 파일명: ${document.filename}`,
    `- MIME Type: ${document.contentType}`,
    "- Gemini API 키가 없거나 문서 요약 호출에 실패해 원문 기반 상세 요약은 생성하지 못했습니다.",
  ].join("\n");

  try {
    const execution = await generateGeminiText({
      systemInstruction:
        "You summarize uploaded documents for a private knowledge system. Return concise Korean Markdown with sections for summary, key points, action items, and classification.",
      parts: [
        createInlineDataPart(document.body, document.contentType),
        { text: input.prompt?.trim() || "Summarize this document and classify what kind of document it is." },
      ],
      thinkingLevel: "high",
      temperature: 0.2,
      maxOutputTokens: 2048,
    });

    const normalized = execution ? { ...execution, markdown: execution.text } : localExecution(fallbackMarkdown);
    await persistConversation(user.id, `summarize:document:${input.attachmentId}`, JSON.stringify(input), normalized);
    return normalized.markdown;
  } catch {
    const normalized = localExecution(fallbackMarkdown);
    await persistConversation(user.id, `summarize:document:${input.attachmentId}`, JSON.stringify(input), normalized);
    return normalized.markdown;
  }
}

export async function extractStructuredData(input: { prompt: string; inputText: string; schema: Record<string, unknown> }) {
  const user = await resolveCurrentUser();
  const fallback = JSON.stringify(
    {
      status: "unavailable",
      message: "Gemini structured extraction is unavailable.",
    },
    null,
    2,
  );

  try {
    const execution = await generateGeminiJson<Record<string, unknown>>({
      systemInstruction: "Return only valid JSON that matches the provided schema. Do not include markdown fences.",
      parts: [{ text: `${input.prompt}\n\n${input.inputText}` }],
      thinkingLevel: "high",
      temperature: 0.2,
      responseJsonSchema: input.schema,
    });

    if (!execution) {
      return JSON.parse(fallback) as Record<string, unknown>;
    }

    await persistConversation(user.id, "extract:structured", JSON.stringify({ prompt: input.prompt, schema: input.schema }), {
      markdown: execution.text,
      model: execution.model,
      inputTokens: execution.inputTokens,
      outputTokens: execution.outputTokens,
      latencyMs: execution.latencyMs,
    });
    return execution.json;
  } catch {
    return JSON.parse(fallback) as Record<string, unknown>;
  }
}

export function createSummarySSE(markdown: string) {
  const encoder = new TextEncoder();
  const chunks = markdown.split("\n").filter((chunk) => chunk.length);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: start\ndata: ${JSON.stringify({ ok: true })}\n\n`));

      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify({ content: `${chunk}\n` })}\n\n`));
      }

      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`));
      controller.close();
    },
  });
}
