import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import {
  AttachmentView,
  PaperAttachmentsService,
  fail,
} from '../paper-attachments/paper-attachments.service';
import { Paper } from '../papers/paper.entity';
import {
  LibraryEntryView,
  PaperLibraryService,
} from '../papers/paper-library.service';
import { normalizeDoi, paperFingerprint } from '../papers/paper.normalize';
import { maxPrivatePapers } from '../papers/paper-private-limit';

const MAX_TITLE_LENGTH = 300;

export interface PrivatePaperResult {
  /** The public id of the paper that now holds the PDF: the catalog paper when the DOI matched, else the new private one. */
  paperId: string;
  /** True for a paper only this reader has. */
  private: boolean;
  /** True when the DOI was already in the catalog and that paper was used instead of creating a second record. */
  matched: boolean;
  /** True when the paper was not in the library yet. */
  created: boolean;
  library: LibraryEntryView;
  attachment: AttachmentView;
}

/** One line of plain text: no control or invisible characters, single spaces. */
function cleanTitle(raw: string): string {
  const title = raw.trim().replace(/\s+/g, ' ');
  if (!title || title.length > MAX_TITLE_LENGTH || /\p{C}/u.test(title)) {
    throw fail(
      400,
      'invalid_title',
      `The title must be plain text of 1 to ${MAX_TITLE_LENGTH} characters.`,
    );
  }
  return title;
}

/**
 * A reader's papers that are not in the catalog (#203): drop a PDF, say what it is, and it becomes a paper only
 * that reader can reach. The PDF goes through the same upload as any attachment (size, content scan, quota).
 *
 * When the DOI is already in the catalog no second record is made: the catalog paper is added to the library
 * with the PDF attached instead. Only public papers match, so one reader's private paper is never found by
 * another reader's DOI.
 */
@Injectable()
export class PrivatePapersService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PaperAttachmentsService)
    private readonly attachments: PaperAttachmentsService,
    @Inject(PaperLibraryService) private readonly library: PaperLibraryService,
  ) {}

  async create(
    userId: number,
    input: { title: string; doi?: string; filename: string; bytes: Buffer },
  ): Promise<PrivatePaperResult> {
    const title = cleanTitle(input.title);
    const doi = input.doi?.trim() ? normalizeDoi(input.doi) : null;
    if (input.doi?.trim() && !doi) {
      throw fail(400, 'invalid_doi', 'That is not a valid DOI.');
    }
    const papers = this.dataSource.getRepository(Paper);

    const match = doi
      ? await papers.findOne({
          where: { doi, ownerId: IsNull() },
          select: { id: true, publicId: true },
        })
      : null;
    if (match) {
      const { attachment } = await this.attachments.upload(
        userId,
        match.id,
        input.bytes,
        input.filename,
      );
      const { entry, created } = await this.library.addById(userId, match.id);
      return {
        paperId: match.publicId,
        private: false,
        matched: true,
        created,
        library: entry,
        attachment,
      };
    }

    // ponytail: count then insert, so two parallel drops can overshoot the cap by one; a lock when it matters.
    const max = maxPrivatePapers();
    if ((await papers.count({ where: { ownerId: userId } })) >= max) {
      throw fail(
        409,
        'private_papers_limit',
        `You can keep up to ${max} papers of your own. Delete one to add another.`,
      );
    }
    const { id } = await papers.save(
      papers.create({
        title,
        doi,
        fingerprint: paperFingerprint(title, null, undefined),
        ownerId: userId,
      }),
    );
    let attachment: AttachmentView;
    try {
      ({ attachment } = await this.attachments.upload(
        userId,
        id,
        input.bytes,
        input.filename,
      ));
    } catch (err) {
      // A paper without its PDF is not what was asked for: it goes, and the cascade queues any stored bytes.
      await papers.delete({ id, ownerId: userId });
      throw err;
    }
    const { entry, created } = await this.library.addById(userId, id);
    return {
      paperId: entry.paperId,
      private: true,
      matched: false,
      created,
      library: entry,
      attachment,
    };
  }
}
