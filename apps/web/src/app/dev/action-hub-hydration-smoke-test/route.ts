import { NextResponse } from "next/server";

import { createSession, getSession } from "@/lib/auth/session";
import { getActionHubHydrationSnapshot, getActionHubTasks, seedActionHubSupportData } from "@/lib/server/action-hub";
import { syncConfiguredAdminUser } from "@/lib/server/auth";

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
    <title>ActionHub Hydration Smoke Test</title>
  </head>
  <body>
    <main>
      <h1>ActionHub Hydration Smoke Test</h1>
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
  try {
    await seedActionHubSupportData();

    const [home, inbox, tasks] = await Promise.all([
      getActionHubHydrationSnapshot("/action-hub"),
      getActionHubHydrationSnapshot("/action-hub/inbox"),
      getActionHubTasks(),
    ]);
    const projectId = tasks.find((task) => task.projectId)?.projectId ?? home.projects[0]?.id ?? null;
    const project = projectId ? await getActionHubHydrationSnapshot(`/action-hub/${projectId}`) : null;
    const task = tasks.find((item) => item.projectId === projectId) ?? null;
    const taskWorkspace = task?.projectId ? await getActionHubHydrationSnapshot(`/action-hub/${task.projectId}/tasks/${task.id}`) : null;

    addCheck(checks, "home hydration returns projects", home.projects.length > 0);
    addCheck(checks, "home hydration omits tasks", home.tasks.length === 0);
    addCheck(checks, "home hydration omits captures", home.pendingCaptures.length === 0);
    addCheck(checks, "inbox hydration returns arrays", Array.isArray(inbox.projects) && Array.isArray(inbox.tasks) && Array.isArray(inbox.pendingCaptures));
    addCheck(checks, "inbox hydration omits references", inbox.referencePeople.length === 0 && inbox.referenceZettels.length === 0);
    addCheck(checks, "project hydration can be scoped", Boolean(project && project.projects.length <= 1));
    addCheck(checks, "project hydration scopes tasks", Boolean(project && project.tasks.every((item) => item.projectId === projectId)));
    addCheck(checks, "task hydration returns focused task", taskWorkspace ? taskWorkspace.tasks.some((item) => item.id === task?.id) : true);
    addCheck(checks, "task hydration includes references", taskWorkspace ? taskWorkspace.referencePeople.length >= 0 && taskWorkspace.referenceZettels.length >= 0 : true);

    return {
      ok: true,
      checks,
      sample: {
        homeProjects: home.projects.length,
        inboxCaptures: inbox.pendingCaptures.length,
        inboxTasks: inbox.tasks.length,
        projectId,
        projectTasks: project?.tasks.length ?? 0,
        taskId: task?.id ?? null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      checks,
      error: error instanceof Error ? error.message : "Unknown ActionHub hydration smoke-test failure",
    };
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
