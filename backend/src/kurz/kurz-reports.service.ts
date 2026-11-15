import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { recordAudit } from '../auth/audit';
import { ConceptLookupService } from '../concept-lookup/concept-lookup.service';
import { returnedRows } from '../shared/sql';
import type { KurzAnswer } from './kurz-answer';

export const REPORT_STATUSES = { open: 0, reviewed: 1, dismissed: 2 } as const;
export type ReportStatus = keyof typeof REPORT_STATUSES;
export const REPORTS_PAGE_SIZE = 25;

export interface ReportView {
  id: string;
  createdAt: string;
  status: ReportStatus;
  /** The page of the post the answer was about, to open it and fix the content when the post was the error. */
  route: string[] | null;
  lang: string;
  postVersion: string | null;
  selection: string | null;
  question: string;
  answer: KurzAnswer;
  model: string;
  promptVersion: number;
  note: string | null;
  reviewedAt: string | null;
}

/**
 * The reports of a wrong answer, for whoever holds `ai_reports.review`. A report is a copy of the exchange and
 * says nothing of who made it: the reviewer sees the exchange, never the student.
 */
@Injectable()
export class KurzReportsService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly lookup: ConceptLookupService,
  ) {}

  async list(
    status: ReportStatus | 'all',
    page: number,
  ): Promise<ReportView[]> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT id, "createdAt", status, "topicKey", lang, "postVersion", selection, question, answer, model,
              "promptVersion", note, "reviewedAt"
         FROM ai_report WHERE ($1::int IS NULL OR status = $1) ORDER BY "createdAt" DESC, id DESC LIMIT $2 OFFSET $3`,
      [
        status === 'all' ? null : REPORT_STATUSES[status],
        REPORTS_PAGE_SIZE,
        (page - 1) * REPORTS_PAGE_SIZE,
      ],
    );
    const names = Object.keys(REPORT_STATUSES) as ReportStatus[];
    return rows.map((r) => ({
      id: String(r.id),
      createdAt: new Date(r.createdAt as string).toISOString(),
      status: names[Number(r.status)],
      route: this.lookup.routeOfTopicKey(String(r.topicKey)),
      lang: String(r.lang),
      postVersion: (r.postVersion as string | null) ?? null,
      selection: (r.selection as string | null) ?? null,
      question: String(r.question),
      answer: r.answer as KurzAnswer,
      model: String(r.model),
      promptVersion: Number(r.promptVersion),
      note: (r.note as string | null) ?? null,
      reviewedAt: r.reviewedAt
        ? new Date(r.reviewedAt as string).toISOString()
        : null,
    }));
  }

  /** Marks a report as reviewed (the answer or the post was fixed) or dismissed (it was right). Recorded in the audit. */
  async review(
    id: string,
    status: 'reviewed' | 'dismissed',
    actorId: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const rows = returnedRows(
        await m.query(
          `UPDATE ai_report SET status = $2, "reviewedByUserId" = $3, "reviewedAt" = now() WHERE id = $1 RETURNING id`,
          [id, REPORT_STATUSES[status], actorId],
        ),
      );
      if (rows.length === 0) throw new NotFoundException();
      await recordAudit(m, actorId, null, 'ai_report.review', {
        reportId: id,
        status,
      });
    });
  }
}
