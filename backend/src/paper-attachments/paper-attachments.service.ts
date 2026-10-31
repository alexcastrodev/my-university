import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Paper } from '../papers/paper.entity';
import { StorageService } from '../storage/storage.service';
import {
  AttachmentLimits,
  loadAttachmentLimits,
} from './paper-attachments.config';
import { VersionState } from './paper-attachment-version.entity';
import { scanPdf } from './pdf-scan';

const MAX_ID = 2_147_483_647;
const KEY_PREFIX = 'papers';
const MAX_NAME_LENGTH = 200;
/** A version still pending after this long belongs to an upload that died; its bytes go. */
const STALE_PENDING_MINUTES = 10;
const MAINTENANCE_EVERY_MS = 5 * 60_000;
const DELETE_BATCH = 20;
const PG_UNIQUE_VIOLATION = '23505';

export interface VersionView {
  version: number;
  state: VersionState;
  filename: string;
  size: number;
  sha256: string;
  rejectCode: string | null;
  rejectReason: string | null;
  uploadedAt: string;
  scannedAt: string | null;
}

export interface AttachmentView {
  id: number;
  visibility: 'private';
  /** The version being served, or null when none passed its scan yet. Newest versions first below. */
  current: number | null;
  versions: VersionView[];
}

export interface DownloadableFile {
  body: Readable;
  size: number;
  filename: string;
  sha256: string;
}

interface Pending {
  attachmentId: number;
  versionId: number;
  key: string;
  created: boolean;
}

interface VersionRow {
  version: number;
  state: VersionState;
  originalName: string;
  size: string;
  sha256: string;
  rejectCode: string | null;
  rejectReason: string | null;
  createdAt: Date;
  scannedAt: Date | null;
}

/** An error the client can branch on: `code` is stable, `message` is for people. */
export const fail = (status: number, code: string, message: string) =>
  new HttpException({ statusCode: status, code, message }, status);

/** A file name is display text only. Keep the last path segment, drop control characters, bound the length. */
export function cleanFilename(raw: string | undefined): string {
  let name = raw ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not percent-encoded after all; use it as it came.
  }
  name = (name.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name && name !== '.' && name !== '..' ? name : 'paper.pdf';
}

/**
 * A reader's private PDF for a paper. Bytes go to object storage under an opaque key; PostgreSQL keeps the
 * key, the checksum and the processing state. Every method takes the user id from the session and looks the
 * attachment up by (paper, owner), so another reader's file is not reachable: it is simply not found.
 *
 * Life of an upload: a `pending` row is written first (so no object ever exists without a row), the bytes
 * are stored, the scan runs, and the row becomes `approved` (the previous approved version, if any, becomes
 * `superseded` and its bytes are queued for deletion) or `rejected` (bytes queued for deletion, reason kept).
 * Only an `approved` version is ever served.
 */
@Injectable()
export class PaperAttachmentsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PaperAttachmentsService.name);
  private readonly limits: AttachmentLimits = loadAttachmentLimits();
  /** Readers with an upload running here: one at a time each, which also keeps memory use bounded. */
  private readonly uploading = new Set<number>();
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  get maxBytes(): number {
    return this.limits.maxBytes;
  }

  onApplicationBootstrap() {
    void this.maintain();
    this.timer = setInterval(() => void this.maintain(), MAINTENANCE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async upload(
    userId: number,
    paperId: number,
    bytes: Buffer,
    filename: string,
  ): Promise<{ attachment: AttachmentView; created: boolean }> {
    this.checkId(paperId);
    if (!bytes.byteLength) {
      throw fail(400, 'empty_body', 'Send the PDF as the request body.');
    }
    if (bytes.byteLength > this.limits.maxBytes) {
      throw fail(413, 'too_large', 'The file is larger than the upload limit.');
    }
    if (this.uploading.has(userId)) {
      throw fail(
        429,
        'upload_in_progress',
        'Another upload of yours is still running.',
      );
    }
    this.uploading.add(userId);
    try {
      const paper = await this.dataSource
        .getRepository(Paper)
        .exists({ where: { id: paperId } });
      if (!paper) throw new NotFoundException('Paper not found');
      if (
        (await this.usedBytes(userId, paperId)) + bytes.byteLength >
        this.limits.quotaBytes
      ) {
        throw fail(
          413,
          'quota_exceeded',
          'Your PDF storage is full. Delete one to upload another.',
        );
      }

      const pending = await this.startVersion(userId, paperId, bytes, filename);
      try {
        await this.storage.put(pending.key, bytes, 'application/pdf');
      } catch (err) {
        this.logger.error(`storing ${pending.key} failed: ${err}`);
        // The row goes; the trigger queues the key in case the object was half written.
        await this.dataSource.query(
          `DELETE FROM paper_attachment_version WHERE id = $1`,
          [pending.versionId],
        );
        throw fail(
          503,
          'storage_unavailable',
          'The file could not be stored. Try again.',
        );
      }

      const verdict = scanPdf(bytes);
      const settled = verdict.ok
        ? await this.approve(pending)
        : await this.reject(pending, verdict.code, verdict.reason);
      if (!settled) {
        // Retired as stale while it uploaded: the object may have been written after its key was handled.
        await this.dataSource.query(
          `INSERT INTO storage_deletion ("objectKey") VALUES ($1)`,
          [pending.key],
        );
        void this.drain();
        throw fail(
          503,
          'upload_expired',
          'The upload took too long. Try again.',
        );
      }
      void this.drain();

      if (!verdict.ok) {
        throw fail(422, verdict.code, verdict.reason);
      }
      return {
        attachment: await this.get(userId, paperId),
        created: pending.created,
      };
    } finally {
      this.uploading.delete(userId);
    }
  }

  async get(userId: number, paperId: number): Promise<AttachmentView> {
    this.checkId(paperId);
    const attachment: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM paper_attachment WHERE "paperId" = $1 AND "ownerId" = $2`,
      [paperId, userId],
    );
    if (!attachment.length) throw new NotFoundException('No PDF attached');
    const versions: VersionRow[] = await this.dataSource.query(
      `SELECT version, state, "originalName", size, sha256, "rejectCode", "rejectReason", "createdAt", "scannedAt"
         FROM paper_attachment_version WHERE "attachmentId" = $1 ORDER BY version DESC`,
      [attachment[0].id],
    );
    return {
      id: attachment[0].id,
      visibility: 'private',
      current: versions.find((v) => v.state === 'approved')?.version ?? null,
      versions: versions.map((v) => ({
        version: v.version,
        state: v.state,
        filename: v.originalName,
        size: Number(v.size),
        sha256: v.sha256,
        rejectCode: v.rejectCode,
        rejectReason: v.rejectReason,
        uploadedAt: v.createdAt.toISOString(),
        scannedAt: v.scannedAt?.toISOString() ?? null,
      })),
    };
  }

  /** The approved file as a stream. A pending, rejected or superseded version is never returned. */
  async open(userId: number, paperId: number): Promise<DownloadableFile> {
    this.checkId(paperId);
    const rows: {
      objectKey: string;
      originalName: string;
      size: string;
      sha256: string;
    }[] = await this.dataSource.query(
      `SELECT v."objectKey", v."originalName", v.size, v.sha256
         FROM paper_attachment a
         JOIN paper_attachment_version v ON v."attachmentId" = a.id AND v.state = 'approved'
        WHERE a."paperId" = $1 AND a."ownerId" = $2`,
      [paperId, userId],
    );
    if (!rows.length) throw new NotFoundException('No approved PDF');
    const file = await this.storage.getStream(rows[0].objectKey);
    if (!file) {
      this.logger.error(
        `approved object ${rows[0].objectKey} is missing from storage`,
      );
      throw fail(
        404,
        'file_missing',
        'The file is not in storage. Upload it again.',
      );
    }
    return {
      body: file.body,
      size: Number(rows[0].size),
      filename: rows[0].originalName,
      sha256: rows[0].sha256,
    };
  }

  /** Deletes the attachment and every version. The objects are queued by a trigger and removed right after. */
  async remove(userId: number, paperId: number): Promise<void> {
    if (!this.validId(paperId)) return;
    await this.dataSource.query(
      `DELETE FROM paper_attachment WHERE "paperId" = $1 AND "ownerId" = $2`,
      [paperId, userId],
    );
    void this.drain();
  }

  /**
   * Deletes the objects in the queue. A key leaves the queue only after storage confirmed the delete
   * (deleting a key that is already gone counts), so a failed delete is retried, never forgotten.
   */
  async drain(): Promise<number> {
    try {
      return await this.dataSource.transaction(async (m) => {
        const rows: { id: number; objectKey: string }[] = await m.query(
          `SELECT id, "objectKey" FROM storage_deletion ORDER BY id LIMIT ${DELETE_BATCH} FOR UPDATE SKIP LOCKED`,
        );
        const done: number[] = [];
        for (const row of rows) {
          try {
            await this.storage.delete(row.objectKey);
            done.push(row.id);
          } catch (err) {
            this.logger.warn(
              `deleting ${row.objectKey} failed, will retry: ${err}`,
            );
            await m.query(
              `UPDATE storage_deletion SET attempts = attempts + 1 WHERE id = $1`,
              [row.id],
            );
          }
        }
        if (done.length) {
          await m.query(`DELETE FROM storage_deletion WHERE id = ANY($1)`, [
            done,
          ]);
        }
        return done.length;
      });
    } catch (err) {
      this.logger.warn(`draining the deletion queue failed: ${err}`);
      return 0;
    }
  }

  /** Retires uploads that died mid-way, then empties the deletion queue. Safe to run on every replica. */
  async maintain(): Promise<void> {
    try {
      await this.dataSource.query(
        `WITH stale AS (
           SELECT id, "objectKey" FROM paper_attachment_version
            WHERE state = 'pending' AND "createdAt" < now() - ($1 * interval '1 minute')
              FOR UPDATE SKIP LOCKED
         ), retired AS (
           UPDATE paper_attachment_version v
              SET state = 'rejected', "objectKey" = NULL, "scannedAt" = now(),
                  "rejectCode" = 'expired', "rejectReason" = 'The upload did not finish.'
             FROM stale WHERE v.id = stale.id
         RETURNING stale."objectKey" AS key
         )
         INSERT INTO storage_deletion ("objectKey") SELECT key FROM retired`,
        [STALE_PENDING_MINUTES],
      );
    } catch (err) {
      this.logger.warn(`retiring stale uploads failed: ${err}`);
    }
    // A full queue takes several batches.
    while ((await this.drain()) === DELETE_BATCH);
  }

  private validId(id: number) {
    return Number.isSafeInteger(id) && id >= 1 && id <= MAX_ID;
  }

  private checkId(id: number) {
    if (!this.validId(id)) throw new NotFoundException('Paper not found');
  }

  /** Bytes the reader holds, not counting the approved file of this paper, which this upload would replace. */
  private async usedBytes(userId: number, paperId: number): Promise<number> {
    const [{ used }]: { used: string }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(v.size), 0) AS used
         FROM paper_attachment_version v JOIN paper_attachment a ON a.id = v."attachmentId"
        WHERE a."ownerId" = $1 AND v.state IN ('pending', 'approved')
          AND NOT (a."paperId" = $2 AND v.state = 'approved')`,
      [userId, paperId],
    );
    return Number(used);
  }

  /** Writes the attachment (if it is new) and a pending version. The object does not exist yet. */
  private async startVersion(
    userId: number,
    paperId: number,
    bytes: Buffer,
    filename: string,
  ) {
    const key = this.storage.newKey(KEY_PREFIX);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      return await this.dataSource.transaction(async (m) => {
        const inserted: { id: number }[] = await m.query(
          `INSERT INTO paper_attachment ("paperId", "ownerId") VALUES ($1, $2)
           ON CONFLICT ("paperId", "ownerId") DO NOTHING RETURNING id`,
          [paperId, userId],
        );
        const [{ id: attachmentId }]: { id: number }[] = await m.query(
          `SELECT id FROM paper_attachment WHERE "paperId" = $1 AND "ownerId" = $2 FOR UPDATE`,
          [paperId, userId],
        );
        const [{ next }]: { next: number }[] = await m.query(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM paper_attachment_version WHERE "attachmentId" = $1`,
          [attachmentId],
        );
        const [{ id: versionId }]: { id: number }[] = await m.query(
          `INSERT INTO paper_attachment_version
             ("attachmentId", version, state, "objectKey", "originalName", size, sha256, "uploadedById")
           VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7) RETURNING id`,
          [
            attachmentId,
            next,
            key,
            cleanFilename(filename),
            bytes.byteLength,
            sha256,
            userId,
          ],
        );
        return { attachmentId, versionId, key, created: inserted.length > 0 };
      });
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw fail(
          429,
          'upload_in_progress',
          'Another upload of this paper is still running.',
        );
      }
      throw err;
    }
  }

  /**
   * Moves the pending version to approved and the previous approved one to superseded, in one transaction.
   * False when the version is no longer pending (the maintenance job retired it as stale while it uploaded).
   */
  private async approve(p: Pending): Promise<boolean> {
    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT 1 FROM paper_attachment WHERE id = $1 FOR UPDATE`, [
        p.attachmentId,
      ]);
      if (!(await this.stillPending(m, p))) return false;
      const old: { id: number; objectKey: string }[] = await m.query(
        `SELECT id, "objectKey" FROM paper_attachment_version
          WHERE "attachmentId" = $1 AND state = 'approved' FOR UPDATE`,
        [p.attachmentId],
      );
      for (const o of old) {
        await m.query(
          `UPDATE paper_attachment_version SET state = 'superseded', "objectKey" = NULL WHERE id = $1`,
          [o.id],
        );
        await this.queueDeletion(m, o.objectKey);
      }
      await m.query(
        `UPDATE paper_attachment_version SET state = 'approved', "scannedAt" = now() WHERE id = $1`,
        [p.versionId],
      );
      await m.query(
        `UPDATE paper_attachment SET "updatedAt" = now() WHERE id = $1`,
        [p.attachmentId],
      );
      return true;
    });
  }

  /** Marks the pending version rejected, queues its bytes for deletion and keeps only the latest refusal. */
  private async reject(
    p: Pending,
    code: string,
    reason: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (m) => {
      if (!(await this.stillPending(m, p))) return false;
      await m.query(
        `UPDATE paper_attachment_version
            SET state = 'rejected', "objectKey" = NULL, "rejectCode" = $2, "rejectReason" = $3, "scannedAt" = now()
          WHERE id = $1`,
        [p.versionId, code, reason],
      );
      await this.queueDeletion(m, p.key);
      await m.query(
        `DELETE FROM paper_attachment_version WHERE "attachmentId" = $1 AND state = 'rejected' AND id <> $2`,
        [p.attachmentId, p.versionId],
      );
      return true;
    });
  }

  private async stillPending(m: EntityManager, p: Pending): Promise<boolean> {
    const rows = await m.query(
      `SELECT 1 FROM paper_attachment_version WHERE id = $1 AND state = 'pending' FOR UPDATE`,
      [p.versionId],
    );
    return rows.length > 0;
  }

  private async queueDeletion(m: EntityManager, key: string) {
    await m.query(`INSERT INTO storage_deletion ("objectKey") VALUES ($1)`, [
      key,
    ]);
  }
}
