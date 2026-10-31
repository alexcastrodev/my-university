import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** What is recorded. Each is a thing that gives someone access to a reader's file or text, or takes it away. */
export const AUDIT_ACTIONS = [
  'attachment.upload',
  'attachment.download',
  'attachment.delete',
  'share.create',
  'share.revoke',
  'library.remove',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEventView {
  id: string;
  action: AuditAction;
  /** The paper's public id: a slug or the UUID of a private paper. */
  paperId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** How long a row is kept (`PAPER_AUDIT_RETENTION_DAYS`). */
const retentionDays = () => Number(process.env.PAPER_AUDIT_RETENTION_DAYS) || 180;
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;
const RECENT = 100;

/**
 * The audit trail of the Papers area (#189). `record` is best effort on purpose: a failure to write the row is
 * logged and never turns a reader's own upload or download into an error. A row never holds a file name, a
 * text, an address or a name: only the action, the paper's id, the reader's id and a few numbers or codes.
 * A reader reads their own rows (`GET /api/paper-library/activity`); nobody else's.
 */
@Injectable()
export class PaperAuditService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaperAuditService.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  onApplicationBootstrap() {
    void this.purge();
    this.timer = setInterval(() => void this.purge(), PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async record(userId: number, action: AuditAction, paperId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO paper_audit_event ("userId", "action", "paperId", "detail") VALUES ($1, $2, $3, $4)`,
        [userId, action, paperId, JSON.stringify(detail)],
      );
    } catch (err) {
      this.logger.error(`could not record ${action}: ${(err as Error).message}`);
    }
  }

  /** The reader's own latest events, newest first. */
  async recent(userId: number): Promise<{ items: AuditEventView[] }> {
    const rows: { id: string; action: AuditAction; paperId: string | null; detail: Record<string, unknown>; createdAt: Date }[] =
      await this.dataSource.query(
        `SELECT id, action, "paperId", detail, "createdAt" FROM paper_audit_event
          WHERE "userId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT ${RECENT}`,
        [userId],
      );
    return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  }

  /** Deletes what is older than the retention period. */
  async purge(): Promise<number> {
    try {
      // TypeORM answers a DELETE with `[rows, count]`.
      const [rows]: [unknown[], number] = await this.dataSource.query(
        `DELETE FROM paper_audit_event WHERE "createdAt" < now() - make_interval(days => $1) RETURNING 1`,
        [retentionDays()],
      );
      return rows.length;
    } catch (err) {
      this.logger.error(`could not purge the audit trail: ${(err as Error).message}`);
      return 0;
    }
  }
}
