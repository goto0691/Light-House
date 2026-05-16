import { NextResponse } from "next/server";
import { ulid } from "ulidx";

import { createSession, getSession } from "@/lib/auth/session";
import {
  acceptPendingCapture,
  attachTaskPerson,
  attachTaskZettel,
  createActionHubProject,
  createChecklistItem,
  cycleActionHubTaskStatus,
  deleteChecklistItem,
  detachTaskPerson,
  detachTaskZettel,
  dismissPendingCapture,
  getActionHubArchive,
  getActionHubProject,
  getActionHubProjectDetail,
  getActionHubTask,
  ingestActionHubCapture,
  routeInboxTaskToProject,
  toggleChecklistItem,
  updateActionHubProjectProperties,
  updateActionHubTaskProperties,
  updateActionHubTaskTitle,
} from "@/lib/server/action-hub";
import { syncConfiguredAdminUser } from "@/lib/server/auth";
import { executeD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type SmokeCheck = { name: string; ok: boolean; detail?: string };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function createSmokeResponse(request: Request, payload: unknown, status = 200) {
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "html") {
    return NextResponse.json(payload, { status });
  }

  return new NextResponse(
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Action Hub Task Delta Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>Action Hub Task Delta Smoke Test</h1>
      <pre data-testid="smoke-result">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </main>
  </body>
</html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

function addCheck(checks: SmokeCheck[], name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  if (!ok) throw new Error(detail ? `${name}: ${detail}` : `${name} failed`);
}

function isLocalRequest(request: Request) {
  return LOCAL_HOSTS.has(new URL(request.url).hostname);
}

async function runSmokeTest() {
  const checks: SmokeCheck[] = [];
  const user = await resolveCurrentUser();
  const suffix = ulid().toLowerCase();
  const projectId = `dev_delta_project_${suffix}`;
  const taskId = `dev_delta_task_${suffix}`;
  const archiveTaskId = `dev_delta_archive_task_${suffix}`;
  const inboxTaskId = `dev_delta_inbox_task_${suffix}`;
  const personId = `dev_delta_person_${suffix}`;
  const zettelId = `dev_delta_zettel_${suffix}`;
  const dismissCaptureId = `dev_delta_capture_dismiss_${suffix}`;
  const taskCaptureId = `dev_delta_capture_task_${suffix}`;
  const zettelCaptureId = `dev_delta_capture_zettel_${suffix}`;
  const personName = "Delta smoke person";
  const zettelTitle = "Delta smoke zettel";
  let createdProjectId: string | null = null;
  let acceptedTaskId: string | null = null;
  let acceptedZettelId: string | null = null;
  let ingestedTaskId: string | null = null;
  let ingestedPendingCaptureId: string | null = null;

  try {
    await executeD1(
      `insert into projects
        (id, user_id, title, slug, description, icon, color, kind, status, category, target_date, progress, pinned, display_order, created_at, updated_at)
     values (?, ?, ?, ?, '', '🛟', 'gold', 'project', 'active', '검증', null, 0, 0, 999, datetime('now'), datetime('now'))`,
      [projectId, user.id, "Delta smoke project", `delta-smoke-${suffix}`],
    );
    await executeD1(`update projects set progress = 100, updated_at = datetime('now') where id = ? and user_id = ?`, [projectId, user.id]);
    await executeD1(
      `insert into tasks
        (id, user_id, project_id, title, kind, content, status, priority, brain_energy, due_at, display_order, created_at, updated_at)
       values (?, ?, ?, 'Delta smoke task', 'research', 'Delta smoke content', 'todo', 'P2', 'normal', null, 0, datetime('now'), datetime('now'))`,
      [taskId, user.id, projectId],
    );
    await executeD1(
      `insert into tasks
        (id, user_id, project_id, title, kind, content, status, priority, brain_energy, due_at, display_order, created_at, updated_at)
       values (?, ?, ?, 'Delta smoke archived task', 'research', 'Delta smoke archived content', 'done', 'P2', 'normal', '2026-05-14', 1, datetime('now'), datetime('now'))`,
      [archiveTaskId, user.id, projectId],
    );
    await executeD1(
      `insert into tasks
        (id, user_id, project_id, title, kind, content, status, priority, brain_energy, due_at, display_order, created_at, updated_at)
       values (?, ?, null, 'Delta smoke inbox task', 'research', 'Delta smoke inbox content', 'todo', 'P2', 'normal', null, 0, datetime('now'), datetime('now'))`,
      [inboxTaskId, user.id],
    );
    await executeD1(
      `insert into people
        (id, user_id, name, groups, dunbar_layer, status, is_favorite, created_at, updated_at)
       values (?, ?, ?, '["검증"]', 150, 'active', 0, datetime('now'), datetime('now'))`,
      [personId, user.id, personName],
    );
    await executeD1(
      `insert into zettels
        (id, user_id, title, slug, content, content_text, summary, type, category, pinned, created_at, updated_at)
       values (?, ?, ?, ?, 'Delta smoke zettel content', 'Delta smoke zettel content', 'Delta smoke zettel summary', 'fleeting', '검증', 0, datetime('now'), datetime('now'))`,
      [zettelId, user.id, zettelTitle, `delta-smoke-zettel-${suffix}`],
    );
    await executeD1(
      `insert into quick_captures
        (id, user_id, raw_text, status, suggested_domain, suggested_fields, confidence, created_at, updated_at)
       values (?, ?, 'Delta smoke dismiss capture', 'pending', 'task', ?, 0.7, datetime('now'), datetime('now'))`,
      [dismissCaptureId, user.id, JSON.stringify({ title: "Delta dismiss task" })],
    );
    await executeD1(
      `insert into quick_captures
        (id, user_id, raw_text, status, suggested_domain, suggested_fields, confidence, created_at, updated_at)
       values (?, ?, 'Delta smoke task capture', 'pending', 'task', ?, 0.9, datetime('now'), datetime('now'))`,
      [
        taskCaptureId,
        user.id,
        JSON.stringify({
          brainEnergy: "routine",
          priority: "P1",
          summary: "Delta accepted task content",
          title: "Delta accepted task",
        }),
      ],
    );
    await executeD1(
      `insert into quick_captures
        (id, user_id, raw_text, status, suggested_domain, suggested_fields, confidence, created_at, updated_at)
       values (?, ?, 'Delta smoke zettel capture', 'pending', 'zettel', ?, 0.9, datetime('now'), datetime('now'))`,
      [zettelCaptureId, user.id, JSON.stringify({ title: "Delta accepted zettel" })],
    );

    const readProject = await getActionHubProject(projectId);
    addCheck(checks, "project read model returns project", readProject?.id === projectId);
    const readDetail = await getActionHubProjectDetail(projectId);
    addCheck(checks, "project detail read model returns project tasks", readDetail?.tasks.some((task) => task.id === taskId) === true);
    addCheck(checks, "project detail read model returns references", Array.isArray(readDetail?.people) && Array.isArray(readDetail?.zettels));
    const readTask = await getActionHubTask(projectId, taskId);
    addCheck(checks, "task read model returns single task", readTask?.id === taskId);
    const readArchive = await getActionHubArchive();
    addCheck(checks, "archive read model returns completed project", readArchive.projects.some((project) => project.id === projectId));
    addCheck(checks, "archive read model returns done task", readArchive.tasks.some((task) => task.id === archiveTaskId));

    const createProjectDelta = await createActionHubProject({
      category: "검증",
      color: "sky",
      description: "Delta smoke created project",
      icon: "D",
      kind: "project",
      targetDate: "2026-05-20",
      title: `Delta smoke created project ${suffix}`,
    });
    createdProjectId = createProjectDelta.project.id;
    addCheck(checks, "project create returns project delta", createProjectDelta.project.title === `Delta smoke created project ${suffix}`);
    addCheck(checks, "project create returns due label", createProjectDelta.project.dueLabel.length > 0);
    addCheck(checks, "project create omits snapshot", !("snapshot" in createProjectDelta));

    const updateProjectDelta = await updateActionHubProjectProperties(createdProjectId, {
      category: "델타",
      color: "gold",
      description: "Delta smoke updated project",
      icon: "P",
      kind: "area",
      status: "paused",
      targetDate: null,
      title: `Delta smoke updated project ${suffix}`,
    });
    addCheck(checks, "project properties returns edited project", updateProjectDelta.project.title === `Delta smoke updated project ${suffix}`);
    addCheck(checks, "project properties returns updated fields", updateProjectDelta.project.kind === "area" && updateProjectDelta.project.status === "paused");
    addCheck(checks, "project properties omits snapshot", !("snapshot" in updateProjectDelta));

    const titleDelta = await updateActionHubTaskTitle(taskId, "Delta smoke task renamed");
    addCheck(checks, "title mutation returns task delta", titleDelta.task.title === "Delta smoke task renamed");
    addCheck(checks, "title mutation includes project delta", titleDelta.project?.id === projectId);

    const statusDelta = await cycleActionHubTaskStatus(taskId);
    addCheck(checks, "status mutation returns next task status", statusDelta.task.status === "in_progress", statusDelta.task.status);

    const propertyDelta = await updateActionHubTaskProperties(taskId, {
      brainEnergy: "routine",
      content: "Delta smoke edited content",
      kind: "research",
      priority: "P1",
      status: "review",
      title: "Delta smoke property save",
    });
    addCheck(checks, "properties mutation returns edited task", propertyDelta.task.priority === "P1" && propertyDelta.task.status === "review");

    const createDelta = await createChecklistItem(taskId, "Delta smoke checklist");
    const createdChecklist = createDelta.task.checklistItems.find((item) => item.content === "Delta smoke checklist");
    addCheck(checks, "checklist create returns updated task", Boolean(createdChecklist?.id), String(createDelta.task.checklist.total));

    const toggleDelta = await toggleChecklistItem(createdChecklist!.id);
    const toggledChecklist = toggleDelta.task.checklistItems.find((item) => item.id === createdChecklist!.id);
    addCheck(checks, "checklist toggle returns updated completion", toggledChecklist?.completed === true);

    const deleteDelta = await deleteChecklistItem(createdChecklist!.id);
    addCheck(checks, "checklist delete returns updated task", !deleteDelta.task.checklistItems.some((item) => item.id === createdChecklist!.id));

    const attachPersonDelta = await attachTaskPerson(taskId, personId);
    addCheck(checks, "person attach returns linked task", attachPersonDelta.task.linkedPeople.includes(personName));

    const detachPersonDelta = await detachTaskPerson(taskId, personName);
    addCheck(checks, "person detach returns unlinked task", !detachPersonDelta.task.linkedPeople.includes(personName));

    const attachZettelDelta = await attachTaskZettel(taskId, zettelId);
    addCheck(checks, "zettel attach returns linked task", attachZettelDelta.task.linkedZettels.includes(zettelTitle));

    const detachZettelDelta = await detachTaskZettel(taskId, zettelTitle);
    addCheck(checks, "zettel detach returns unlinked task", !detachZettelDelta.task.linkedZettels.includes(zettelTitle));

    const routeDelta = await routeInboxTaskToProject(inboxTaskId, projectId);
    addCheck(checks, "inbox route returns routed task", routeDelta.task.projectId === projectId);
    addCheck(checks, "inbox route includes target project delta", routeDelta.project?.id === projectId);

    const dismissDelta = await dismissPendingCapture(dismissCaptureId);
    addCheck(checks, "capture dismiss returns pending capture delta", dismissDelta.pendingCaptureId === dismissCaptureId);

    const acceptTaskDelta = await acceptPendingCapture(taskCaptureId);
    acceptedTaskId = acceptTaskDelta.routedEntity?.id ?? null;
    addCheck(checks, "capture accept task removes pending capture", acceptTaskDelta.pendingCaptureId === taskCaptureId);
    addCheck(checks, "capture accept task returns created task", acceptTaskDelta.task?.title === "Delta accepted task");

    const acceptZettelDelta = await acceptPendingCapture(zettelCaptureId);
    acceptedZettelId = acceptZettelDelta.routedEntity?.id ?? null;
    addCheck(checks, "capture accept zettel removes pending capture", acceptZettelDelta.pendingCaptureId === zettelCaptureId);
    addCheck(
      checks,
      "capture accept zettel returns reference zettel",
      acceptZettelDelta.referenceZettel?.title === "Delta accepted zettel",
    );

    const ingestTaskResult = await ingestActionHubCapture("Delta smoke forced task capture", {
      forceDomain: "task",
      projectId,
    });
    ingestedTaskId = ingestTaskResult.taskId ?? null;
    addCheck(checks, "quick capture task ingest returns routed status", ingestTaskResult.status === "routed");
    addCheck(checks, "quick capture task ingest returns task delta", ingestTaskResult.delta.task?.id === ingestedTaskId);
    addCheck(checks, "quick capture task ingest returns project delta", ingestTaskResult.delta.project?.id === projectId);
    addCheck(checks, "quick capture task ingest omits snapshot", !("snapshot" in ingestTaskResult));

    const ingestPendingResult = await ingestActionHubCapture("Delta smoke forced zettel capture", {
      forceDomain: "zettel",
    });
    ingestedPendingCaptureId = ingestPendingResult.captureId;
    addCheck(checks, "quick capture pending ingest returns pending status", ingestPendingResult.status === "pending");
    addCheck(
      checks,
      "quick capture pending ingest returns pending capture delta",
      ingestPendingResult.delta.pendingCapture?.id === ingestedPendingCaptureId,
    );
    addCheck(checks, "quick capture pending ingest omits snapshot", !("snapshot" in ingestPendingResult));

    return {
      ok: true,
      checks,
      sample: {
        acceptedTaskId,
        acceptedZettelId,
        createdProjectId,
        ingestedPendingCaptureId,
        ingestedTaskId,
        archiveTaskId,
        projectId,
        taskId,
        inboxTaskId,
        taskTitle: deleteDelta.task.title,
        checklistTotal: deleteDelta.task.checklist.total,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown Action Hub task delta smoke-test failure",
    };
  } finally {
    if (createdProjectId) {
      await executeD1(`delete from projects where id = ? and user_id = ?`, [createdProjectId, user.id]).catch(() => undefined);
    }
    if (acceptedTaskId) await executeD1(`delete from checklists where task_id = ?`, [acceptedTaskId]).catch(() => undefined);
    if (acceptedTaskId) {
      await executeD1(`delete from tasks where id = ? and user_id = ?`, [acceptedTaskId, user.id]).catch(() => undefined);
    }
    if (acceptedZettelId) {
      await executeD1(`delete from zettels where id = ? and user_id = ?`, [acceptedZettelId, user.id]).catch(() => undefined);
    }
    if (ingestedTaskId) await executeD1(`delete from checklists where task_id = ?`, [ingestedTaskId]).catch(() => undefined);
    if (ingestedTaskId) {
      await executeD1(`delete from task_people_relations where task_id = ?`, [ingestedTaskId]).catch(() => undefined);
      await executeD1(`delete from task_zettel_relations where task_id = ?`, [ingestedTaskId]).catch(() => undefined);
      await executeD1(`delete from tasks where id = ? and user_id = ?`, [ingestedTaskId, user.id]).catch(() => undefined);
    }
    if (ingestedPendingCaptureId) {
      await executeD1(`delete from quick_captures where id = ? and user_id = ?`, [ingestedPendingCaptureId, user.id]).catch(() => undefined);
    }
    await executeD1(`delete from quick_captures where id in (?, ?, ?) and user_id = ?`, [
      dismissCaptureId,
      taskCaptureId,
      zettelCaptureId,
      user.id,
    ]).catch(() => undefined);
    await executeD1(`delete from checklists where task_id = ?`, [taskId]).catch(() => undefined);
    await executeD1(`delete from task_people_relations where task_id = ?`, [taskId]).catch(() => undefined);
    await executeD1(`delete from task_zettel_relations where task_id = ?`, [taskId]).catch(() => undefined);
    await executeD1(`delete from tasks where id = ? and user_id = ?`, [taskId, user.id]).catch(() => undefined);
    await executeD1(`delete from tasks where id = ? and user_id = ?`, [archiveTaskId, user.id]).catch(() => undefined);
    await executeD1(`delete from tasks where id = ? and user_id = ?`, [inboxTaskId, user.id]).catch(() => undefined);
    await executeD1(`delete from people where id = ? and user_id = ?`, [personId, user.id]).catch(() => undefined);
    await executeD1(`delete from zettels where id = ? and user_id = ?`, [zettelId, user.id]).catch(() => undefined);
    await executeD1(`delete from projects where id = ? and user_id = ?`, [projectId, user.id]).catch(() => undefined);
  }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return createSmokeResponse(request, { error: "Not found" }, 404);
  }

  const session = await getSession();
  if (!session) {
    if (!isLocalRequest(request)) {
      return createSmokeResponse(request, { error: "로그인이 필요합니다." }, 401);
    }

    const url = new URL(request.url);
    if (url.searchParams.get("session") === "created") {
      return createSmokeResponse(request, { error: "개발 검증 세션을 만들지 못했습니다." }, 401);
    }

    const admin = await syncConfiguredAdminUser();
    await createSession({ userId: admin.id });
    url.searchParams.set("session", "created");
    return NextResponse.redirect(url, { status: 303 });
  }

  const result = await runSmokeTest();
  return createSmokeResponse(request, result, result.ok ? 200 : 500);
}
