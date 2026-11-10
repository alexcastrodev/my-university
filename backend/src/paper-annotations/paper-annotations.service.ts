import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaperRef, refColumn, isUuid } from '../papers/paper-ref';
import { PaperLibraryEntry } from '../papers/paper-library.entity';
import {
  AnnotationKind,
  AnnotationRect,
  PaperAnnotation,
} from './paper-annotation.entity';
import { CreateAnnotationDto, UpdateAnnotationDto } from './paper-annotation.dto';
import { ShareView, sharesOf } from './paper-annotation-share-queries';

export interface AnnotationView {
  id: string;
  kind: AnnotationKind;
  body: string | null;
  page: number | null;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  rects: AnnotationRect[] | null;
  /** The PDF version it was made on; null for a note. */
  pdfVersion: number | null;
  /** True when the PDF now served is not the file it was made on: it is kept, shown for review, never moved. */
  stale: boolean;
  /** What the reader chose to publish of it (#187), or null while it is private, which is the default. */
  share: ShareView | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The PDF served now, or null when the paper has none. */
interface Current {
  version: number;
  sha256: string;
}

/** How many annotations one library entry keeps; `PAPER_ANNOTATIONS_MAX_PER_ENTRY` changes it. */
const maxPerEntry = () => Number(process.env.PAPER_ANNOTATIONS_MAX_PER_ENTRY) || 2000;

const BOOKMARK_LABEL = 200;

/**
 * A reader's notes, highlights, comments, questions and bookmarks on one paper of their library (#186). Every
 * call starts from the signed-in reader's own library entry, so an annotation of someone else is the same
 * 404 as one that does not exist.
 */
@Injectable()
export class PaperAnnotationsService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  async list(userId: number, ref: PaperRef) {
    const entry = await this.entryOf(userId, ref);
    const current = await this.currentOf(userId, ref);
    const rows = await this.dataSource.getRepository(PaperAnnotation).find({
      where: { entryId: entry.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const shares = await sharesOf(this.dataSource, rows.map((r) => r.id));
    return { version: current?.version ?? null, items: rows.map((r) => view(r, current, shares.get(r.id))) };
  }

  async create(userId: number, ref: PaperRef, dto: CreateAnnotationDto): Promise<AnnotationView> {
    const entry = await this.entryOf(userId, ref);
    const body = dto.body?.trim() || null;
    const repo = this.dataSource.getRepository(PaperAnnotation);

    if ((await repo.count({ where: { entryId: entry.id } })) >= maxPerEntry()) {
      throw new ConflictException({
        statusCode: 409,
        code: 'annotations_limit',
        message: `You can keep up to ${maxPerEntry()} notes and annotations on a paper. Delete one to add another.`,
      });
    }

    if (dto.kind === 'note') {
      if (!body) throw bad('note_empty', 'A note needs some text');
      if ([dto.version, dto.page, dto.quote, dto.prefix, dto.suffix, dto.rects].some((v) => v !== undefined)) {
        throw bad('note_has_no_place', 'A note has no place in the PDF');
      }
      return view(await repo.save(repo.create({ entryId: entry.id, kind: 'note', body })), null, undefined);
    }

    if (!dto.page || !dto.version) throw bad('anchor_required', 'An annotation needs the PDF version and the page');
    const quote = dto.quote?.trim() || null;
    const rects = dto.rects?.length ? dto.rects : null;
    if (dto.kind === 'highlight' && (!quote || !rects)) {
      throw bad('highlight_needs_text', 'A highlight needs the selected text and where it is');
    }
    if ((dto.kind === 'comment' || dto.kind === 'question') && !body) {
      throw bad('body_required', 'A comment or a question needs some text');
    }
    if (dto.kind === 'bookmark') {
      if (quote || rects) throw bad('bookmark_is_a_page', 'A bookmark marks a page, not a selection');
      if (body && body.length > BOOKMARK_LABEL) throw bad('label_too_long', `A bookmark label is up to ${BOOKMARK_LABEL} characters`);
    }

    const current = await this.currentOf(userId, ref);
    if (!current) {
      throw new ConflictException({ statusCode: 409, code: 'no_pdf', message: 'This paper has no PDF to annotate' });
    }
    if (current.version !== dto.version) {
      throw new ConflictException({
        statusCode: 409,
        code: 'stale_version',
        message: 'The PDF was replaced since you opened it. Reload it to annotate the new one.',
        version: current.version,
      });
    }

    const saved = await repo.save(
      repo.create({
        entryId: entry.id,
        kind: dto.kind,
        body,
        pdfVersion: current.version,
        pdfSha256: current.sha256,
        page: dto.page,
        quote,
        prefix: dto.prefix || null,
        suffix: dto.suffix || null,
        rects,
      }),
    );
    return view(saved, current, undefined);
  }

  async update(userId: number, ref: PaperRef, id: string, dto: UpdateAnnotationDto): Promise<AnnotationView> {
    const row = await this.own(userId, ref, id);
    const repo = this.dataSource.getRepository(PaperAnnotation);
    const current = await this.currentOf(userId, ref);
    const typed = dto.body === undefined ? undefined : dto.body.trim() || null;

    if (dto.kind === 'note') {
      if (row.kind === 'note' || !view(row, current, undefined).stale) {
        throw bad('not_stale', 'Only an annotation the PDF outgrew can become a note');
      }
      const text = [row.quote && `> ${row.quote.replace(/\s+/g, ' ')}`, typed === undefined ? row.body : typed]
        .filter(Boolean)
        .join('\n\n');
      Object.assign(row, {
        kind: 'note',
        body: text || `Page ${row.page}`,
        page: null,
        pdfVersion: null,
        pdfSha256: null,
        quote: null,
        prefix: null,
        suffix: null,
        rects: null,
      });
    } else if (typed !== undefined) {
      if (!typed && ['note', 'comment', 'question'].includes(row.kind)) {
        throw bad('body_required', 'This needs some text');
      }
      if (row.kind === 'bookmark' && typed && typed.length > BOOKMARK_LABEL) {
        throw bad('label_too_long', `A bookmark label is up to ${BOOKMARK_LABEL} characters`);
      }
      row.body = typed;
    }
    const saved = await repo.save(row);
    return view(saved, current, (await sharesOf(this.dataSource, [saved.id])).get(saved.id));
  }

  /** The reader's own annotation. Someone else's, one on a paper outside their library and one that is not there are the same 404. */
  async own(userId: number, ref: PaperRef, id: string): Promise<PaperAnnotation> {
    const entry = await this.entryOf(userId, ref);
    const row = isUuid(id)
      ? await this.dataSource.getRepository(PaperAnnotation).findOne({ where: { id: id.toLowerCase(), entryId: entry.id } })
      : null;
    if (!row) throw new NotFoundException();
    return row;
  }

  async remove(userId: number, ref: PaperRef, id: string): Promise<void> {
    const entry = await this.entryOf(userId, ref);
    const res = isUuid(id)
      ? await this.dataSource
          .getRepository(PaperAnnotation)
          .delete({ id: id.toLowerCase(), entryId: entry.id })
      : { affected: 0 };
    if (!res.affected) throw new NotFoundException();
  }

  private async entryOf(userId: number, ref: PaperRef): Promise<PaperLibraryEntry> {
    const entry = await this.dataSource.getRepository(PaperLibraryEntry).findOne({
      where: ref.kind === 'public' ? { userId, paperSlug: ref.slug } : { userId, paperId: ref.id },
    });
    if (!entry) throw new NotFoundException('Not in your library');
    return entry;
  }

  /** The approved version of the reader's own PDF for this paper, the one the reader shows. */
  private async currentOf(userId: number, ref: PaperRef): Promise<Current | null> {
    const { column, value } = refColumn(ref);
    const rows: Current[] = await this.dataSource.query(
      `SELECT v.version, v.sha256
         FROM paper_attachment a
         JOIN paper_attachment_version v ON v."attachmentId" = a.id AND v.state = 'approved'
        WHERE a."ownerId" = $1 AND a."${column}" = $2`,
      [userId, value],
    );
    return rows[0] ?? null;
  }
}

const bad = (code: string, message: string) =>
  new BadRequestException({ statusCode: 400, code, message });

function view(row: PaperAnnotation, current: Current | null, share: ShareView | undefined): AnnotationView {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    page: row.page,
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    rects: row.rects,
    pdfVersion: row.pdfVersion,
    stale: row.kind !== 'note' && row.pdfSha256 !== current?.sha256,
    share: share ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
