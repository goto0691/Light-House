import "server-only";

import { queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";
import { DEFAULT_DASHBOARD_LAYOUTS, DEFAULT_SHORTCUT_BINDINGS, listSavedViews, listShortcutBindings, listWidgetLayouts } from "@/lib/server/ui-state";

type UsageRow = {
  count: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

type ConversationRow = {
  id: string;
  purpose: string;
  model: string;
  createdAt: string;
};

type BackupRow = {
  id: string;
  createdAt: string;
  snapshot: string | null;
};

type BackupSnapshotRow = {
  id: string;
  createdAt: string;
  bucketKey: string;
  status: string;
  format: string;
  sizeBytes: number | null;
};

type ImportRow = {
  importBatchId: string | null;
  createdAt: string;
  fileName: string | null;
  importSummary: string | null;
  restoreSummary: string | null;
};

type ImportJobRow = {
  id: string;
  createdAt: string;
  fileName: string;
  status: string;
  previewSummary: string | null;
  resultSummary: string | null;
};

type CronRow = {
  id: string;
  action: string;
  createdAt: string;
  snapshot: string | null;
};

type CountRow = {
  total: number | null;
};

type MigrationReviewIssueRow = {
  issueType: string;
  status: string;
  count: number | null;
};

type MigrationReviewItemRow = {
  id: string;
  issueType: string;
  suggestedAction: string;
  entityType: string;
  entityId: string | null;
  status: string;
  confidence: number | null;
  reason: string | null;
  createdAt: string;
};

export async function getSettingsHomeOverview() {
  const user = await resolveCurrentUser();

  return {
    profile: {
      displayName: user.displayName,
      email: user.email,
      locale: user.locale,
      timezone: user.timezone,
      theme: user.preferences.theme,
    },
  };
}

export async function getAppearanceSettingsOverview() {
  const user = await resolveCurrentUser();
  const dashboardLayouts = await listWidgetLayouts("dashboard");

  return {
    theme: user.preferences.theme,
    glassOpacity: user.preferences.glassOpacity,
    dashboardLayouts: dashboardLayouts.length
      ? dashboardLayouts
      : DEFAULT_DASHBOARD_LAYOUTS.map((item, index) => ({
          id: `default-${item.widgetKey}`,
          pageKey: "dashboard",
          widgetKey: item.widgetKey,
          titleOverride: item.titleOverride ?? null,
          layout: item.layout,
          isHidden: item.isHidden ?? false,
          displayOrder: item.displayOrder ?? index,
        })),
  };
}

export async function getShortcutSettingsOverview() {
  const bindings = await listShortcutBindings();

  return {
    bindings: bindings.length
      ? bindings
      : DEFAULT_SHORTCUT_BINDINGS.map((item, index) => ({
          id: `default-${item.actionKey}`,
          category: item.category,
          actionKey: item.actionKey,
          label: item.label,
          binding: item.binding,
          isEnabled: item.isEnabled ?? true,
          isCustom: false,
          displayOrder: item.displayOrder ?? index,
        })),
  };
}

export async function getAISettingsOverview() {
  const user = await resolveCurrentUser();
  const [usageResult, recentResult] = await Promise.all([
    queryD1<UsageRow>(
      `select
         count(*) as count,
         coalesce(sum(input_tokens), 0) as inputTokens,
         coalesce(sum(output_tokens), 0) as outputTokens
       from ai_conversations
       where user_id = ?
         and strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')`,
      [user.id],
    ),
    queryD1<ConversationRow>(
      `select id, purpose, model, created_at as createdAt
       from ai_conversations
       where user_id = ?
       order by created_at desc
       limit 6`,
      [user.id],
    ),
  ]);

  const usage = usageResult.rows[0];

  return {
    enabled: user.preferences.aiEnabled,
    threshold: user.preferences.aiRoutingThreshold,
    fallbackModel: user.preferences.aiFallbackModel,
    usage: {
      conversations: Number(usage?.count ?? 0),
      inputTokens: Number(usage?.inputTokens ?? 0),
      outputTokens: Number(usage?.outputTokens ?? 0),
    },
    recentConversations: recentResult.rows.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      model: row.model,
      createdAt: row.createdAt,
    })),
  };
}

export async function getIntegrationSettingsOverview() {
  const user = await resolveCurrentUser();
  const cronResult = await queryD1<CronRow>(
    `select id, action, created_at as createdAt, snapshot
     from audit_logs
     where user_id = ?
       and action like 'cron.%'
     order by created_at desc
     limit 8`,
    [user.id],
  );

  return {
    integrations: [
      { id: "d1", label: "Cloudflare D1", configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_D1_DATABASE_ID) },
      { id: "r2", label: "Cloudflare R2", configured: Boolean(process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) },
      { id: "vectorize", label: "Cloudflare Vectorize", configured: Boolean(process.env.VECTORIZE_INDEX) },
      { id: "gemini", label: "Google Gemini API", configured: Boolean(process.env.GEMINI_API_KEY) },
      { id: "cron", label: "Cron Secret", configured: Boolean(process.env.CRON_SECRET) },
    ],
    recentRuns: cronResult.rows.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      summary: row.snapshot,
    })),
  };
}

export async function getDataSettingsOverview() {
  const user = await resolveCurrentUser();
<<<<<<< Updated upstream
  const [projects, tasks, people, zettels, media, workouts, dailyLogs, backups, imports, relationStats, reviewStats, duplicateMedia, savedViews] = await Promise.all([
=======
  const [
    projects,
    tasks,
    people,
    zettels,
    media,
    workouts,
    dailyLogs,
    backups,
    imports,
    relationStats,
    reviewStats,
    duplicateMedia,
    savedViews,
    migrationReviewIssues,
    migrationReviewItems,
  ] = await Promise.all([
>>>>>>> Stashed changes
    queryD1<CountRow>(`select count(*) as total from projects where user_id = ? and deleted_at is null`, [user.id]),
    queryD1<CountRow>(`select count(*) as total from tasks where user_id = ? and deleted_at is null`, [user.id]),
    queryD1<CountRow>(`select count(*) as total from people where user_id = ?`, [user.id]),
    queryD1<CountRow>(`select count(*) as total from zettels where user_id = ? and deleted_at is null`, [user.id]),
    queryD1<CountRow>(`select count(*) as total from media_logs where user_id = ? and deleted_at is null`, [user.id]),
    queryD1<CountRow>(`select count(*) as total from workouts where user_id = ? and deleted_at is null`, [user.id]),
    queryD1<CountRow>(`select count(*) as total from daily_logs where user_id = ?`, [user.id]),
    queryD1<BackupSnapshotRow>(
      `select
         id,
         created_at as createdAt,
         bucket_key as bucketKey,
         status,
         format,
         size_bytes as sizeBytes
       from backup_snapshots
       where user_id = ?
         and deleted_at is null
       order by created_at desc
       limit 10`,
      [user.id],
    ),
    queryD1<ImportJobRow>(
      `select
         id,
         created_at as createdAt,
         file_name as fileName,
         status,
         preview_summary as previewSummary,
         result_summary as resultSummary
       from import_jobs
       where user_id = ?
         and deleted_at is null
       order by created_at desc
       limit 12`,
      [user.id],
    ),
    queryD1<{
      taskProjects: number | null;
      taskPeople: number | null;
      taskZettels: number | null;
      zettelPeople: number | null;
      mediaPeople: number | null;
      dailyPeople: number | null;
      zettelMedia: number | null;
      importedProjects: number | null;
      importedTasks: number | null;
      importedZettels: number | null;
      importedMedia: number | null;
      importedPeople: number | null;
      importedDailyLogs: number | null;
      importedWorkouts: number | null;
    }>(
      `select
         (select count(*) from tasks where user_id = ? and project_id is not null and deleted_at is null) as taskProjects,
         (select count(*) from task_people_relations tpr inner join tasks t on t.id = tpr.task_id where t.user_id = ?) as taskPeople,
         (select count(*) from task_zettel_relations tzr inner join tasks t on t.id = tzr.task_id where t.user_id = ?) as taskZettels,
         (select count(*) from zettel_people_relations zpr inner join zettels z on z.id = zpr.zettel_id where z.user_id = ?) as zettelPeople,
         (select count(*) from media_people_relations mpr inner join media_logs m on m.id = mpr.media_id where m.user_id = ?) as mediaPeople,
         (select count(*) from daily_log_people_relations dlpr inner join daily_logs dl on dl.id = dlpr.daily_log_id where dl.user_id = ?) as dailyPeople,
         (select count(*) from zettel_media_relations zmr inner join zettels z on z.id = zmr.zettel_id where z.user_id = ?) as zettelMedia,
         (select count(*) from projects where user_id = ? and import_batch_id is not null and deleted_at is null) as importedProjects,
         (select count(*) from tasks where user_id = ? and import_batch_id is not null and deleted_at is null) as importedTasks,
         (select count(*) from zettels where user_id = ? and import_batch_id is not null and deleted_at is null) as importedZettels,
         (select count(*) from media_logs where user_id = ? and import_batch_id is not null and deleted_at is null) as importedMedia,
         (select count(*) from people where user_id = ? and notion_source_id is not null and deleted_at is null) as importedPeople,
         (select count(*) from daily_logs where user_id = ? and import_batch_id is not null and deleted_at is null) as importedDailyLogs,
         (select count(*) from workouts where user_id = ? and import_batch_id is not null and deleted_at is null) as importedWorkouts`,
      [user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id],
    ),
    queryD1<{
      needsReviewZettels: number | null;
      hiddenAutoLogs: number | null;
      activeImportedUntaggedZettels: number | null;
    }>(
      `select
         (select count(*)
          from taggings tg
          inner join tags t on t.id = tg.tag_id
          inner join zettels z on z.id = tg.taggable_id
          where tg.taggable_type = 'zettel' and t.slug = 'needs-review' and z.user_id = ? and z.deleted_at is null) as needsReviewZettels,
         (select count(*)
          from taggings tg
          inner join tags t on t.id = tg.tag_id
          inner join zettels z on z.id = tg.taggable_id
          where tg.taggable_type = 'zettel' and t.slug = 'auto-log' and z.user_id = ? and z.deleted_at is not null) as hiddenAutoLogs,
         (select count(*)
          from zettels z
          where z.user_id = ? and z.deleted_at is null and z.import_batch_id is not null
            and not exists (
              select 1 from taggings tg where tg.taggable_type = 'zettel' and tg.taggable_id = z.id
            )) as activeImportedUntaggedZettels`,
      [user.id, user.id, user.id],
    ),
    queryD1<{ title: string; mediaType: string; count: number | null }>(
      `select trim(title) as title, media_type as mediaType, count(*) as count
       from media_logs
       where user_id = ? and deleted_at is null
       group by lower(trim(title)), media_type
       having count(*) > 1
       order by count(*) desc, title asc
       limit 8`,
      [user.id],
    ),
    listSavedViews(),
<<<<<<< Updated upstream
=======
    queryD1<MigrationReviewIssueRow>(
      `select issue_type as issueType, status, count(*) as count
       from migration_review_items
       where user_id = ? and deleted_at is null
       group by issue_type, status
       order by issue_type asc, status asc`,
      [user.id],
    ).catch(() => ({ rows: [] as MigrationReviewIssueRow[], meta: {} })),
    queryD1<MigrationReviewItemRow>(
      `select
         id,
         issue_type as issueType,
         suggested_action as suggestedAction,
         entity_type as entityType,
         entity_id as entityId,
         status,
         confidence,
         reason,
         created_at as createdAt
       from migration_review_items
       where user_id = ? and deleted_at is null
       order by case when status = 'open' then 0 else 1 end, created_at desc
       limit 12`,
      [user.id],
    ).catch(() => ({ rows: [] as MigrationReviewItemRow[], meta: {} })),
>>>>>>> Stashed changes
  ]);

  const relation = relationStats.rows[0];

  let backupItems: Array<{ id: string; createdAt: string; summary: string }> = backups.rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    summary: `${row.bucketKey} · ${row.format.toUpperCase()} · ${row.status}${row.sizeBytes ? ` · ${row.sizeBytes} bytes` : ""}`,
  }));

  if (!backupItems.length) {
    const fallbackBackups = await queryD1<BackupRow>(
      `select id, created_at as createdAt, snapshot
       from audit_logs
       where user_id = ? and action = 'cron.daily_backup'
       order by created_at desc
       limit 10`,
      [user.id],
    );

    backupItems = fallbackBackups.rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      summary: row.snapshot ?? "백업 메타 정보가 없습니다.",
    }));
  }

  let importItems: Array<{
    id: string;
    importBatchId: string | null;
    createdAt: string;
    fileName: string;
    summary: string;
    restoreSummary: string;
  }> = imports.rows.map((row) => ({
    id: row.id,
    importBatchId: row.id,
    createdAt: row.createdAt,
    fileName: row.fileName,
    summary: row.previewSummary ?? `상태: ${row.status}`,
    restoreSummary: row.resultSummary ?? "실행 결과가 아직 없습니다.",
  }));

  if (!importItems.length) {
    const fallbackImports = await queryD1<ImportRow>(
      `select
         import_batch_id as importBatchId,
         max(created_at) as createdAt,
         max(case when action = 'settings.data.notion_import' then entity_id end) as fileName,
         max(case when action = 'settings.data.notion_import' then snapshot end) as importSummary,
         max(case when action = 'settings.data.notion_restore' then snapshot end) as restoreSummary
       from audit_logs
       where user_id = ?
         and import_batch_id is not null
         and action in ('settings.data.notion_import', 'settings.data.notion_restore')
       group by import_batch_id
       order by max(created_at) desc
       limit 12`,
      [user.id],
    );

    importItems = fallbackImports.rows.map((row) => ({
      id: row.importBatchId ?? row.createdAt,
      importBatchId: row.importBatchId,
      createdAt: row.createdAt,
      fileName: row.fileName ?? "배치 파일명 없음",
      summary: row.importSummary ?? "가져오기 메타 정보가 없습니다.",
      restoreSummary: row.restoreSummary ?? "관계 복원 기록이 아직 없습니다.",
    }));
  }

  return {
    entityCounts: {
      projects: Number(projects.rows[0]?.total ?? 0),
      tasks: Number(tasks.rows[0]?.total ?? 0),
      people: Number(people.rows[0]?.total ?? 0),
      zettels: Number(zettels.rows[0]?.total ?? 0),
      media: Number(media.rows[0]?.total ?? 0),
      workouts: Number(workouts.rows[0]?.total ?? 0),
      dailyLogs: Number(dailyLogs.rows[0]?.total ?? 0),
    },
    relationHealth: {
      taskProjects: Number(relation?.taskProjects ?? 0),
      taskPeople: Number(relation?.taskPeople ?? 0),
      taskZettels: Number(relation?.taskZettels ?? 0),
      zettelPeople: Number(relation?.zettelPeople ?? 0),
      mediaPeople: Number(relation?.mediaPeople ?? 0),
      dailyPeople: Number(relation?.dailyPeople ?? 0),
      zettelMedia: Number(relation?.zettelMedia ?? 0),
      importedProjects: Number(relation?.importedProjects ?? 0),
      importedTasks: Number(relation?.importedTasks ?? 0),
      importedZettels: Number(relation?.importedZettels ?? 0),
      importedMedia: Number(relation?.importedMedia ?? 0),
      importedPeople: Number(relation?.importedPeople ?? 0),
      importedDailyLogs: Number(relation?.importedDailyLogs ?? 0),
      importedWorkouts: Number(relation?.importedWorkouts ?? 0),
<<<<<<< Updated upstream
=======
    },
    reviewHealth: {
      needsReviewZettels: Number(reviewStats.rows[0]?.needsReviewZettels ?? 0),
      hiddenAutoLogs: Number(reviewStats.rows[0]?.hiddenAutoLogs ?? 0),
      activeImportedUntaggedZettels: Number(reviewStats.rows[0]?.activeImportedUntaggedZettels ?? 0),
    },
    duplicateMedia: duplicateMedia.rows.map((row) => ({
      title: row.title,
      mediaType: row.mediaType,
      count: Number(row.count ?? 0),
    })),
    savedViews: savedViews.map((view) => ({
      id: view.id,
      domain: view.domain,
      scope: view.scope,
      name: view.name,
      query: view.searchQuery,
    })),
    migrationReview: {
      issues: migrationReviewIssues.rows.map((row) => ({
        issueType: row.issueType,
        status: row.status,
        count: Number(row.count ?? 0),
      })),
      items: migrationReviewItems.rows.map((row) => ({
        id: row.id,
        issueType: row.issueType,
        suggestedAction: row.suggestedAction,
        entityType: row.entityType,
        entityId: row.entityId,
        status: row.status,
        confidence: row.confidence,
        reason: row.reason,
        createdAt: row.createdAt,
      })),
>>>>>>> Stashed changes
    },
    reviewHealth: {
      needsReviewZettels: Number(reviewStats.rows[0]?.needsReviewZettels ?? 0),
      hiddenAutoLogs: Number(reviewStats.rows[0]?.hiddenAutoLogs ?? 0),
      activeImportedUntaggedZettels: Number(reviewStats.rows[0]?.activeImportedUntaggedZettels ?? 0),
    },
    duplicateMedia: duplicateMedia.rows.map((row) => ({
      title: row.title,
      mediaType: row.mediaType,
      count: Number(row.count ?? 0),
    })),
    savedViews: savedViews.map((view) => ({
      id: view.id,
      domain: view.domain,
      scope: view.scope,
      name: view.name,
      query: view.searchQuery,
    })),
    backups: backupItems,
    recentImports: importItems,
  };
}
