import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaperAuditService } from '../paper-audit/paper-audit.service';
import { PaperRef, isUuid } from '../papers/paper-ref';
import { ShareAnnotationDto } from './paper-annotation.dto';
import { PaperAnnotationsService } from './paper-annotations.service';
import { SHAREABLE_KINDS } from './paper-annotation-share.entity';
import { SharedAnnotationView, ShareView, excerpt, profileKeyOf, sharesOf } from './paper-annotation-share-queries';

/** How many annotations one reader keeps shared; `PAPER_SHARES_MAX_PER_USER` changes it. */
const maxPerUser = () => Number(process.env.PAPER_SHARES_MAX_PER_USER) || 200;
/** What one paper page lists. */
const PAGE_LIMIT = 200;

const bad = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });

/**
 * Publishing a reader's annotations on purpose (#187). Nothing is shared until the reader asks, one annotation
 * at a time; what is published is a copy (see `PaperAnnotationShare`) and never gives a way to the private
 * annotation, the library entry or the PDF. Only the author can share, change or take back a share.
 */
@Injectable()
export class PaperAnnotationSharesService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PaperAnnotationsService) private readonly annotations: PaperAnnotationsService,
    @Inject(PaperAuditService) private readonly audit: PaperAuditService,
  ) {}

  /** Shares an annotation, or shares it again: the copy is made anew and the audience replaced. */
  async share(userId: number, ref: PaperRef, id: string, dto: ShareAnnotationDto): Promise<ShareView> {
    if (ref.kind !== 'public') {
      throw bad('private_paper', 'A paper only you can see has no page to share on');
    }
    const row = await this.annotations.own(userId, ref, id);
    if (!(SHAREABLE_KINDS as readonly string[]).includes(row.kind)) {
      throw bad('not_shareable', 'A bookmark cannot be shared');
    }
    const recipients = await this.recipientsOf(userId, dto);

    const [{ count }]: { count: string }[] = await this.dataSource.query(
      `SELECT count(*) FROM paper_annotation_share WHERE "authorId" = $1 AND "annotationId" <> $2`,
      [userId, row.id],
    );
    if (Number(count) >= maxPerUser()) {
      throw new ConflictException({
        statusCode: 409,
        code: 'shares_limit',
        message: `You can keep up to ${maxPerUser()} annotations shared. Stop sharing one to share another.`,
      });
    }

    await this.dataSource.transaction(async (tx) => {
      const [{ id: shareId }]: { id: string }[] = await tx.query(
        `INSERT INTO paper_annotation_share ("annotationId", "paperSlug", "authorId", visibility, kind, body, page, quote)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ("annotationId") DO UPDATE
            SET visibility = EXCLUDED.visibility, kind = EXCLUDED.kind, body = EXCLUDED.body,
                page = EXCLUDED.page, quote = EXCLUDED.quote, "updatedAt" = now()
         RETURNING id`,
        [row.id, ref.slug, userId, dto.visibility, row.kind, row.body, row.page, excerpt(row.quote)],
      );
      await tx.query(`DELETE FROM paper_annotation_share_recipient WHERE "shareId" = $1`, [shareId]);
      for (const recipient of recipients) {
        await tx.query(`INSERT INTO paper_annotation_share_recipient ("shareId", "userId") VALUES ($1, $2)`, [shareId, recipient]);
      }
    });
    await this.audit.record(userId, 'share.create', ref.slug, { visibility: dto.visibility, kind: row.kind, recipients: recipients.length });
    return (await sharesOf(this.dataSource, [row.id])).get(row.id)!;
  }

  /** Takes the share back: from that moment nobody but the author can see the copy. Nothing to take back is fine. */
  async unshare(userId: number, ref: PaperRef, id: string): Promise<void> {
    const row = await this.annotations.own(userId, ref, id);
    // TypeORM answers a DELETE with `[rows, count]`.
    const [gone]: [unknown[], number] = await this.dataSource.query(
      `DELETE FROM paper_annotation_share WHERE "annotationId" = $1 AND "authorId" = $2 RETURNING 1`,
      [row.id, userId],
    );
    if (gone.length && ref.kind === 'public') await this.audit.record(userId, 'share.revoke', ref.slug, { kind: row.kind });
  }

  /**
   * What the viewer may read on a public paper: the shares for everyone, those that name them, and their own.
   * An anonymous visitor (`viewerId` null) gets the first kind only.
   */
  // ponytail: the first PAGE_LIMIT by page, no paging; add it when a paper actually has more shares than that.
  async visibleOn(slug: string, viewerId: number | null): Promise<{ items: SharedAnnotationView[] }> {
    const rows: (Omit<SharedAnnotationView, 'author' | 'mine' | 'sharedAt'> & {
      authorId: number;
      createdAt: Date;
      name: string;
      avatarUrl: string;
      profileSlug: string | null;
      publicProfileId: string;
      profilePublic: boolean;
    })[] = await this.dataSource.query(
      `SELECT s.id, s.kind, s.body, s.page, s.quote, s.visibility, s."authorId", s."createdAt",
              COALESCE(NULLIF(trim(u."displayNameOverride"), ''), u."displayName") AS name,
              u."avatarUrl", u."profileSlug", u."publicProfileId", u."profilePublic"
         FROM paper_annotation_share s
         JOIN "user" u ON u.id = s."authorId"
        WHERE s."paperSlug" = $1
          AND (s.visibility = 'public'
               OR s."authorId" = $2::int
               OR EXISTS (SELECT 1 FROM paper_annotation_share_recipient r WHERE r."shareId" = s.id AND r."userId" = $2::int))
        ORDER BY s.page NULLS LAST, s."createdAt", s.id
        LIMIT ${PAGE_LIMIT}`,
      [slug, viewerId],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        page: r.page,
        quote: r.quote,
        visibility: r.visibility,
        mine: r.authorId === viewerId,
        // The link is only given for a profile its owner made public; the name is what they chose to publish under.
        author: { name: r.name, avatarUrl: r.avatarUrl, profile: r.profilePublic ? (r.profileSlug ?? r.publicProfileId) : null },
        sharedAt: r.createdAt,
      })),
    };
  }

  /** The ids of the readers a share is for. A name that is no public profile is refused, whoever holds it. */
  private async recipientsOf(userId: number, dto: ShareAnnotationDto): Promise<number[]> {
    const named = dto.recipients ?? [];
    if (dto.visibility === 'public') {
      if (named.length) throw bad('recipients_only_for_users', 'Recipients are for a share with chosen people');
      return [];
    }
    if (!named.length) throw bad('recipients_required', 'Name at least one reader to share with');

    const keys = [...new Set(named.map(profileKeyOf))];
    const ids: number[] = [];
    for (const key of keys) {
      const [found]: { id: number }[] = await this.dataSource.query(
        `SELECT id FROM "user" WHERE "profilePublic" AND ${isUuid(key) ? `"publicProfileId" = $1::uuid` : `"profileSlug" = $1`}`,
        [key],
      );
      // Not found covers a name nobody has and a profile that is not public, so asking tells nothing about either.
      if (!found) throw bad('recipient_not_found', `Nobody has the public profile "${key.slice(0, 60)}"`);
      if (found.id === userId) throw bad('recipient_is_you', 'You already see what you share');
      ids.push(found.id);
    }
    return [...new Set(ids)];
  }
}
