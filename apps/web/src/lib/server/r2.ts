import "server-only";

import { Buffer } from "node:buffer";
import path from "node:path";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { ulid } from "ulidx";

import { executeD1, queryD1 } from "@/lib/server/cloudflare-d1";
import { resolveCurrentUser } from "@/lib/server/session-user";

type AttachmentRow = {
  id: string;
  userId: string;
  ownerType: string;
  ownerId: string;
  kind: string;
  r2Key: string;
  cdnUrl: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  meta: string | null;
};

type AttachmentMeta = {
  version: 1;
  storage: {
    provider: "r2";
    bucket: string;
    originalKey: string;
    previewKey: string;
    nasPath: string;
    previewStatus: "pending" | "ready" | "skipped";
  };
  urls: {
    preview: string;
    original: string;
  };
  image?: {
    originalMimeType: string;
    previewMimeType: string;
    width?: number;
    height?: number;
  };
};

type UploadTarget = {
  attachmentId: string;
  uploadUrl: string;
  originalKey: string;
  previewKey: string;
  previewUrl: string;
  originalUrl: string;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function getBucketName() {
  return getRequiredEnv("R2_BUCKET");
}

function getR2PublicUrl() {
  return process.env.R2_PUBLIC_URL?.replace(/\/$/, "") || "";
}

function createR2Client() {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "file";
}

function buildAttachmentKeys(filename: string, mimeType: string) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const ext = path.extname(filename) || (mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg");
  const basename = sanitizeSegment(path.basename(filename, path.extname(filename)));
  const id = ulid().toLowerCase();

  return {
    originalKey: `originals/${yyyy}/${mm}/${id}-${basename}${ext}`,
    previewKey: `previews/${yyyy}/${mm}/${id}-${basename}.webp`,
    nasPath: `photos/${yyyy}/${mm}/${id}-${basename}${ext}`,
  };
}

function buildInternalVariantUrl(attachmentId: string, variant: "preview" | "original") {
  return `/api/upload/files/${attachmentId}/${variant}`;
}

function createAttachmentMeta(attachmentId: string, input: { originalKey: string; previewKey: string; nasPath: string; mimeType: string }): AttachmentMeta {
  return {
    version: 1,
    storage: {
      provider: "r2",
      bucket: getBucketName(),
      originalKey: input.originalKey,
      previewKey: input.previewKey,
      nasPath: input.nasPath,
      previewStatus: "pending",
    },
    urls: {
      preview: buildInternalVariantUrl(attachmentId, "preview"),
      original: buildInternalVariantUrl(attachmentId, "original"),
    },
    image: input.mimeType.startsWith("image/")
      ? {
          originalMimeType: input.mimeType,
          previewMimeType: "image/webp",
        }
      : undefined,
  };
}

function parseAttachmentMeta(meta: string | null): AttachmentMeta | null {
  if (!meta) return null;

  try {
    return JSON.parse(meta) as AttachmentMeta;
  } catch {
    return null;
  }
}

async function streamToBuffer(stream: ReadableStream | NodeJS.ReadableStream | Blob | undefined) {
  if (!stream) {
    return Buffer.alloc(0);
  }

  if (typeof Blob !== "undefined" && stream instanceof Blob) {
    const arrayBuffer = await stream.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if ("getReader" in stream) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;

    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        chunks.push(result.value);
      }
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  const asyncIterable = stream as AsyncIterable<Uint8Array | Buffer | string>;
  const chunks: Buffer[] = [];
  for await (const chunk of asyncIterable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getAttachmentById(attachmentId: string) {
  const user = await resolveCurrentUser();
  const result = await queryD1<AttachmentRow>(
    `select
       id,
       user_id as userId,
       owner_type as ownerType,
       owner_id as ownerId,
       kind,
       r2_key as r2Key,
       cdn_url as cdnUrl,
       filename,
       mime_type as mimeType,
       size_bytes as sizeBytes,
       meta
     from attachments
     where id = ? and user_id = ?
     limit 1`,
    [attachmentId, user.id],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("첨부 파일을 찾지 못했습니다.");
  }

  return row;
}

export async function createSignedUploadTarget(input: {
  ownerType: string;
  ownerId: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const user = await resolveCurrentUser();
  const attachmentId = ulid();
  const keys = buildAttachmentKeys(input.filename, input.mimeType);
  const meta = createAttachmentMeta(attachmentId, {
    originalKey: keys.originalKey,
    previewKey: keys.previewKey,
    nasPath: keys.nasPath,
    mimeType: input.mimeType,
  });

  await executeD1(
    `insert into attachments
      (id, user_id, owner_type, owner_id, kind, r2_key, cdn_url, filename, mime_type, size_bytes, meta, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      attachmentId,
      user.id,
      input.ownerType,
      input.ownerId,
      input.kind,
      keys.originalKey,
      meta.urls.preview,
      input.filename,
      input.mimeType,
      input.sizeBytes,
      JSON.stringify(meta),
    ],
  );

  const client = createR2Client();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: keys.originalKey,
      ContentType: input.mimeType,
    }),
    { expiresIn: 60 * 15 },
  );

  return {
    attachmentId,
    uploadUrl,
    originalKey: keys.originalKey,
    previewKey: keys.previewKey,
    previewUrl: meta.urls.preview,
    originalUrl: meta.urls.original,
    nasPath: keys.nasPath,
  } satisfies UploadTarget & { nasPath: string };
}

export async function completeAttachmentUpload(attachmentId: string) {
  const attachment = await getAttachmentById(attachmentId);
  const meta = parseAttachmentMeta(attachment.meta);
  if (!meta) {
    throw new Error("첨부 메타데이터가 손상되었습니다.");
  }

  const client = createR2Client();
  const bucket = getBucketName();
  const originalObject = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: meta.storage.originalKey,
    }),
  );

  let nextMeta = meta;
  let cdnUrl = meta.urls.original;

  if (attachment.mimeType.startsWith("image/")) {
    const originalBuffer = await streamToBuffer(originalObject.Body);
    const image = sharp(originalBuffer);
    const info = await image.metadata();
    const previewBuffer = await image
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: meta.storage.previewKey,
        Body: previewBuffer,
        ContentType: "image/webp",
      }),
    );

    nextMeta = {
      ...meta,
      storage: {
        ...meta.storage,
        previewStatus: "ready",
      },
      image: {
        originalMimeType: attachment.mimeType,
        previewMimeType: "image/webp",
        width: info.width,
        height: info.height,
      },
    };
    cdnUrl = meta.urls.preview;
  } else {
    nextMeta = {
      ...meta,
      storage: {
        ...meta.storage,
        previewStatus: "skipped",
      },
    };
  }

  await executeD1(
    `update attachments
     set cdn_url = ?, meta = ?, updated_at = datetime('now')
     where id = ? and user_id = ?`,
    [cdnUrl, JSON.stringify(nextMeta), attachment.id, attachment.userId],
  );

  return {
    attachmentId: attachment.id,
    previewUrl: nextMeta.urls.preview,
    originalUrl: nextMeta.urls.original,
    nasPath: nextMeta.storage.nasPath,
    publicPreviewUrl: getR2PublicUrl() ? `${getR2PublicUrl()}/${nextMeta.storage.previewKey}` : null,
    publicOriginalUrl: getR2PublicUrl() ? `${getR2PublicUrl()}/${nextMeta.storage.originalKey}` : null,
  };
}

export async function getAttachmentVariant(attachmentId: string, variant: "preview" | "original") {
  const attachment = await getAttachmentById(attachmentId);
  const meta = parseAttachmentMeta(attachment.meta);
  if (!meta) {
    throw new Error("첨부 메타데이터가 손상되었습니다.");
  }

  const key = variant === "preview" && meta.storage.previewStatus === "ready" ? meta.storage.previewKey : meta.storage.originalKey;
  const contentType = variant === "preview" && meta.storage.previewStatus === "ready" ? meta.image?.previewMimeType || "image/webp" : attachment.mimeType;

  const client = createR2Client();
  const object = await client.send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }),
  );

  const body = await streamToBuffer(object.Body);

  return {
    body,
    contentType,
    filename: attachment.filename,
    mode: variant === "preview" && meta.storage.previewStatus === "ready" ? "preview" : "original",
    nasPath: meta.storage.nasPath,
  };
}
