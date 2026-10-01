/** Metadata is user writable in older captures. Only a runner source with its
 * exact completed run, original attachment, and capture can claim AI origin. */
export function analysisExtractionProofSql(source = "s", document = "d", owner = "o") {
  const metadata = `(case when json_valid(${source}.source_metadata) then ${source}.source_metadata else '{}' end)`;
  return `exists (
    select 1 from v2_processing_runs extraction_run
    join v2_processing_jobs extraction_job on extraction_job.id=extraction_run.job_id and extraction_job.user_id=extraction_run.user_id
    join v2_source_items original on original.id=json_extract(${metadata},'$.derived_from_source_item_id')
      and original.user_id=extraction_run.user_id and original.capture_id=${document}.capture_id
    join v2_document_source_links original_link on original_link.source_item_id=original.id and original_link.document_object_id=${document}.object_id
    join v2_source_attachment_links original_attachment on original_attachment.source_item_id=original.id and original_attachment.user_id=original.user_id
    join v2_attachment_reservations reservation on reservation.id=original_attachment.attachment_id and reservation.user_id=original.user_id
      and reservation.status='committed' and reservation.committed_at is not null
    where extraction_run.id=json_extract(${metadata},'$.processing_run_id')
      and extraction_run.user_id=${owner}.user_id and extraction_run.status='succeeded'
      and extraction_job.object_id=${document}.object_id and extraction_job.capture_id=${document}.capture_id
      and extraction_job.stage='analyze' and extraction_job.status='succeeded'
      and extraction_job.input_revision_id=json_extract(${metadata},'$.document_revision_id')
      and ${source}.id='analysis_source:'||extraction_run.id||':'||original.id
      and ${source}.user_id=${owner}.user_id and ${source}.capture_id=${document}.capture_id
      and json_extract(${metadata},'$.purpose')='analysis_extraction'
      and json_extract(${metadata},'$.extraction_kind')=case
        when reservation.mime_type like 'image/%' then 'image_ocr'
        when reservation.mime_type like 'audio/%' or reservation.mime_type like 'video/%' then 'transcript_extract'
        else 'document_extract' end
  )`;
}
