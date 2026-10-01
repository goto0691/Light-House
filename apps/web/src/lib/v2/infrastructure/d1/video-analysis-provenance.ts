import { VIDEO_ANALYSIS_ADAPTER_VERSION } from "@/lib/v2/domain/video-analysis-source";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

/** Source metadata is user writable in capture input, so a video-analysis label
 * needs a server proof: the record's earliest snapshot containing the source was
 * written by the video adapter ('api'). Snapshots are immutable and restore remaps
 * the snapshot, member and source keys together, so the proof survives restores. */
export function videoAnalysisProofSql(source = "s", documentObjectId = "d.object_id") {
  return `(${source}.item_kind='transcript' and exists (
    select 1 from v2_link_snapshot_sources video_origin_member
    join v2_link_snapshots video_origin on video_origin.id=video_origin_member.snapshot_id and video_origin.user_id=video_origin_member.user_id
    where video_origin_member.source_item_id=${source}.id and video_origin_member.user_id=${source}.user_id
      and video_origin.document_object_id=${documentObjectId}
      and video_origin.acquisition_method='api' and video_origin.adapter_version='${VIDEO_ANALYSIS_ADAPTER_VERSION}'
      and not exists (
        select 1 from v2_link_snapshot_sources video_earlier_member
        join v2_link_snapshots video_earlier on video_earlier.id=video_earlier_member.snapshot_id and video_earlier.user_id=video_earlier_member.user_id
        where video_earlier_member.source_item_id=${source}.id and video_earlier_member.user_id=${source}.user_id
          and video_earlier.document_object_id=video_origin.document_object_id and video_earlier.snapshot_version<video_origin.snapshot_version)
  ))`;
}

export async function hasVideoAnalysisProvenanceSchema(db: D1DatabaseBinding) {
  const row = await db.prepare("select count(*) as count from sqlite_master where type='table' and name in ('v2_link_snapshots','v2_link_snapshot_sources')")
    .first<{ count: number }>();
  return row?.count === 2;
}
