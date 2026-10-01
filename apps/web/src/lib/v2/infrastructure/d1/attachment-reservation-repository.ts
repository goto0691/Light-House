import type { AttachmentReservation } from "@/lib/v2/domain/attachment-reservation";
import { validateAttachmentReservation } from "@/lib/v2/domain/attachment-reservation";
import { legacyProjectionVisibilityPredicate } from "@/lib/v2/infrastructure/d1/legacy-projection-visibility";
import type { D1DatabaseBinding } from "@/lib/v2/infrastructure/d1/source-commit-repository";

type ReservationRow = {
  id: string;
  user_id: string;
  object_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  expires_at: string;
  status: "reserved" | "uploaded_unverified" | "verified" | "committed" | "expired";
};

export class D1AttachmentReservationRepository {
  constructor(
    private readonly db: D1DatabaseBinding,
    private readonly userId: string,
  ) {
    if (!userId.trim()) throw new Error("A scoped repository requires a userId.");
  }

  async create(reservation: AttachmentReservation, createdAt: string) {
    validateAttachmentReservation(reservation);
    if (reservation.userId !== this.userId) throw new Error("Reservation owner does not match repository scope.");
    await this.db
      .prepare(
        `insert into v2_attachment_reservations
         (id,user_id,status,object_key,filename,mime_type,size_bytes,sha256,created_at,expires_at)
         values (?,?,'reserved',?,?,?,?,?,?,?)`,
      )
      .bind(
        reservation.id,
        this.userId,
        reservation.objectKey,
        reservation.filename,
        reservation.expectedMimeType,
        reservation.expectedSize,
        reservation.expectedSha256,
        createdAt,
        reservation.expiresAt,
      )
      .run();
    return reservation;
  }

  async find(id: string): Promise<(AttachmentReservation & { status: ReservationRow["status"] }) | null> {
    const row = await this.db
      .prepare(
        `select id,user_id,object_key,filename,mime_type,size_bytes,sha256,expires_at,status
         from v2_attachment_reservations where id=? and user_id=? limit 1`,
      )
      .bind(id, this.userId)
      .first<ReservationRow>();
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      objectKey: row.object_key,
      filename: row.filename,
      expectedMimeType: row.mime_type,
      expectedSize: row.size_bytes,
      expectedSha256: row.sha256,
      expiresAt: row.expires_at,
      status: row.status,
    };
  }

  async findCommittedAccess(id: string): Promise<((AttachmentReservation & { status: "committed" }) & { privacyLevel: "normal" | "sensitive" | "restricted" }) | null> {
    const legacyVisibility = await legacyProjectionVisibilityPredicate(this.db);
    const row = await this.db
      .prepare(
        `select a.id,a.user_id,a.object_key,a.filename,a.mime_type,a.size_bytes,a.sha256,a.expires_at,a.status,d.privacy_level
         from v2_attachment_reservations a
         join v2_source_attachment_links sal on sal.attachment_id=a.id and sal.user_id=a.user_id
         join v2_document_source_links dsl on dsl.source_item_id=sal.source_item_id
         join v2_documents d on d.object_id=dsl.document_object_id
         join v2_objects o on o.id=d.object_id and o.user_id=a.user_id
         where a.id=? and a.user_id=? and a.status='committed' and ${legacyVisibility} limit 1`,
      )
      .bind(id, this.userId)
      .first<ReservationRow & { privacy_level: "normal" | "sensitive" | "restricted" }>();
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      objectKey: row.object_key,
      filename: row.filename,
      expectedMimeType: row.mime_type,
      expectedSize: row.size_bytes,
      expectedSha256: row.sha256,
      expiresAt: row.expires_at,
      status: "committed",
      privacyLevel: row.privacy_level,
    };
  }

  async markUploadedUnverified(id: string) {
    await this.db
      .prepare(
        `update v2_attachment_reservations set status='uploaded_unverified'
         where id=? and user_id=? and status in ('reserved','uploaded_unverified')`,
      )
      .bind(id, this.userId)
      .run();
  }

  async markVerified(id: string, verifiedAt: string) {
    await this.db
      .prepare(
        `update v2_attachment_reservations set status='verified',verified_at=?
         where id=? and user_id=? and status in ('reserved','uploaded_unverified')`,
      )
      .bind(verifiedAt, id, this.userId)
      .run();
    return this.find(id);
  }
}
