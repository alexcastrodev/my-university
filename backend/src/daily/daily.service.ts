import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewSourceType } from '../review/review-schedule.entity';
import { ReviewService } from '../review/review.service';
import { ReviewRating } from '../review/sm2';
import { XpService } from '../xp/xp.service';
import { DailyWriteAnswer } from './daily-write-answer.entity';
import {
  excerptParagraphs,
  firstCodeBlock,
  firstSectionWithCode,
  firstSubstantialSection,
  textAfterCodeBlock,
} from './daily-content';

export type DailyCardType = 'recall' | 'read' | 'notice' | 'write';

/** Flat XP per card — matches the four-card "about five minutes" framing from the mockup. */
const XP_PER_CARD = 20;
const WRITE_MAX_LENGTH = 240;
/** How far back into read history to look for Read/Notice source material. */
const HISTORY_LOOKBACK = 20;

interface CodeBlockDto {
  header: string;
  badge?: string;
  source: string;
}

interface RecallCardDto {
  type: 'recall';
  xp: number;
  previewTitle: string;
  previewSubtitle: string;
  recap: string;
  kicker: string;
  title: string;
  context: string;
  sourceType: ReviewSourceType;
  sourceId: string;
  route: string[];
  wrongNote: string;
}

interface ReadCardDto {
  type: 'read';
  xp: number;
  previewTitle: string;
  previewSubtitle: string;
  recap: string;
  kicker: string;
  breadcrumb: string;
  title: string;
  body: string;
  code?: CodeBlockDto;
  note?: string;
  fullTopicRoute: string[];
  sourceId: string;
}

interface NoticeCardDto {
  type: 'notice';
  xp: number;
  previewTitle: string;
  previewSubtitle: string;
  recap: string;
  kicker: string;
  title: string;
  code: CodeBlockDto;
  lead?: string;
  takeawayLabel?: string;
  takeaway?: string;
  sourceId: string;
}

interface WriteCardDto {
  type: 'write';
  xp: number;
  previewTitle: string;
  previewSubtitle: string;
  recap: string;
  kicker: string;
  title: string;
  placeholderHint: string;
  maxLength: number;
  pastAnswer?: { when: string; text: string; note: string };
  footnote: string;
  sourceId: string;
}

type DailyCardDto = RecallCardDto | ReadCardDto | NoticeCardDto | WriteCardDto;

export interface DailySessionDto {
  estimatedMinutes: number;
  cards: DailyCardDto[];
  summary: {
    headline: string;
    tomorrow: { title: string; body: string };
  };
}

function formatDate(date: Date): string {
  return date
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

@Injectable()
export class DailyService {
  constructor(
    private review: ReviewService,
    private xp: XpService,
    @InjectRepository(DailyWriteAnswer) private writeAnswers: Repository<DailyWriteAnswer>,
  ) {}

  async buildSession(userId: number): Promise<DailySessionDto> {
    const recall = await this.buildRecallCard(userId);

    const rawHistory = await this.xp.getHistory(userId, HISTORY_LOOKBACK);
    const history = rawHistory.filter(
      (entry): entry is typeof entry & { sourceType: ReviewSourceType } =>
        entry.sourceType === 'concept-read' || entry.sourceType === 'episode-watched',
    );
    const readEntry = this.pickReadEntry(history, recall?.sourceId);
    const readCard = readEntry ? this.buildReadCard(readEntry) : null;

    const noticeEntry = readEntry
      ? this.pickNoticeEntry(history, readEntry.sourceId) ?? readEntry
      : null;
    const noticeCard = noticeEntry ? this.buildNoticeCard(noticeEntry) : null;

    const writeCard = readCard ? await this.buildWriteCard(userId, readCard) : null;

    const cards: DailyCardDto[] = [recall, readCard, noticeCard, writeCard].filter(
      (c): c is DailyCardDto => c !== null,
    );

    return {
      estimatedMinutes: Math.max(1, cards.length),
      cards,
      summary: this.buildSummary(cards),
    };
  }

  private async buildRecallCard(userId: number): Promise<RecallCardDto | null> {
    const due = await this.review.getDueQueue(userId);
    if (due.length === 0) return null;
    const item = due[0];

    return {
      type: 'recall',
      xp: XP_PER_CARD,
      previewTitle: item.title,
      previewSubtitle: `Marked "Got it" earlier`,
      recap: `Recall · ${item.title}`,
      kicker: 'RECALL · NO LOOKING BACK',
      title: item.title,
      context: `You marked "${item.title}" as "Got it" before. Does it still hold?`,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      route: item.route,
      wrongNote:
        'Getting it wrong is not a penalty. It reopens the topic and puts it back in a future session.',
    };
  }

  /** Most recent read-history entry whose content resolves and is substantial, excluding
   *  whatever sourceId Recall already used (so the session doesn't repeat one concept twice). */
  private pickReadEntry(
    history: { sourceType: ReviewSourceType; sourceId: string; updatedAt: Date }[],
    excludeSourceId: string | undefined,
  ): { sourceType: ReviewSourceType; sourceId: string; title: string; sections: { title: string; content: string }[]; route: string[] } | null {
    for (const entry of history) {
      if (entry.sourceId === excludeSourceId) continue;
      const detail = this.review.resolveConceptDetail(entry.sourceType, entry.sourceId);
      if (!detail) continue;
      if (!firstSubstantialSection(detail.sections)) continue;
      return { sourceType: entry.sourceType, sourceId: entry.sourceId, ...detail };
    }
    return null;
  }

  /** A second, distinct history entry whose content has a real code snippet — the Notice
   *  card's source. Falls back to reusing the Read entry itself in `buildSession`. */
  private pickNoticeEntry(
    history: { sourceType: ReviewSourceType; sourceId: string; updatedAt: Date }[],
    excludeSourceId: string,
  ): { sourceType: ReviewSourceType; sourceId: string; title: string; sections: { title: string; content: string }[]; route: string[] } | null {
    for (const entry of history) {
      if (entry.sourceId === excludeSourceId) continue;
      const detail = this.review.resolveConceptDetail(entry.sourceType, entry.sourceId);
      if (!detail) continue;
      if (!firstSectionWithCode(detail.sections)) continue;
      return { sourceType: entry.sourceType, sourceId: entry.sourceId, ...detail };
    }
    return null;
  }

  private buildReadCard(entry: {
    sourceId: string;
    title: string;
    sections: { title: string; content: string }[];
    route: string[];
  }): ReadCardDto | null {
    const section = firstSubstantialSection(entry.sections);
    if (!section) return null;

    const body = excerptParagraphs(section.content, 2);
    const code = firstCodeBlock(section.content);

    return {
      type: 'read',
      xp: XP_PER_CARD,
      previewTitle: entry.title,
      previewSubtitle: 'From what you read recently',
      recap: `Read · ${entry.title}`,
      kicker: 'READ · ONE SCREEN',
      breadcrumb: entry.title,
      title: entry.title,
      body,
      code: code
        ? { header: entry.title.toUpperCase(), source: code.code }
        : undefined,
      note: 'This is the whole card. The full topic has more.',
      fullTopicRoute: entry.route,
      sourceId: entry.sourceId,
    };
  }

  private buildNoticeCard(entry: {
    sourceId: string;
    title: string;
    sections: { title: string; content: string }[];
  }): NoticeCardDto | null {
    const section = firstSectionWithCode(entry.sections) ?? entry.sections.find((s) => firstCodeBlock(s.content));
    if (!section) return null;
    const code = firstCodeBlock(section.content);
    if (!code) return null;

    const after = textAfterCodeBlock(section.content, 2);

    return {
      type: 'notice',
      xp: XP_PER_CARD,
      previewTitle: entry.title,
      previewSubtitle: 'A real snippet from what you read',
      recap: `Notice · ${entry.title}`,
      kicker: 'NOTICE · FROM THE REAL SOURCE',
      title: entry.title,
      code: { header: entry.title.toUpperCase(), source: code.code },
      lead: after[0],
      takeawayLabel: after[1] ? 'NOTE' : undefined,
      takeaway: after[1],
      sourceId: entry.sourceId,
    };
  }

  private async buildWriteCard(userId: number, readCard: ReadCardDto): Promise<WriteCardDto> {
    const previous = await this.writeAnswers.findOne({
      where: { userId, sourceId: readCard.sourceId },
      order: { createdAt: 'DESC' },
    });

    return {
      type: 'write',
      xp: XP_PER_CARD,
      previewTitle: readCard.title,
      previewSubtitle: 'One line, in your own words',
      recap: `Write · ${readCard.title}`,
      kicker: 'WRITE · ONE LINE',
      title: `In your own words: what's the core idea behind "${readCard.title}"?`,
      placeholderHint: 'One or two sentences is enough',
      maxLength: WRITE_MAX_LENGTH,
      pastAnswer: previous
        ? {
            when: `YOU WROTE ON ${formatDate(previous.createdAt)}`,
            text: previous.text,
            note: 'Both answers are kept. Neither replaces the other.',
          }
        : undefined,
      footnote: `Saving this adds ${XP_PER_CARD} XP.`,
      sourceId: readCard.sourceId,
    };
  }

  private buildSummary(cards: DailyCardDto[]): DailySessionDto['summary'] {
    if (cards.length === 0) {
      return {
        headline: 'Nothing to review yet',
        tomorrow: {
          title: 'Read one concept first',
          body: 'Once you mark something as read, a session assembles itself from it.',
        },
      };
    }
    const readCard = cards.find((c): c is ReadCardDto => c.type === 'read');
    return {
      headline: readCard ? `Built from "${readCard.title}"` : 'Today\'s session',
      tomorrow: {
        title: 'Assembled fresh next time',
        body: 'Nothing is scheduled — the session is built from what you last read and what is due when you open it.',
      },
    };
  }

  async completeCard(
    userId: number,
    type: DailyCardType,
    sourceId: string,
    options: { sourceType?: ReviewSourceType; rating?: ReviewRating; text?: string },
  ): Promise<{ xpAwarded: number }> {
    if (type === 'recall') {
      if (!options.sourceType || !options.rating) {
        throw new BadRequestException('recall completion requires sourceType and rating');
      }
      await this.review.recordAnswer(userId, options.sourceType, sourceId, options.rating);
    }

    if (type === 'write') {
      const text = options.text?.trim();
      if (!text) throw new BadRequestException('write completion requires non-empty text');
      if (text.length > WRITE_MAX_LENGTH) {
        throw new BadRequestException(`text exceeds ${WRITE_MAX_LENGTH} characters`);
      }
      await this.writeAnswers.save(this.writeAnswers.create({ userId, sourceId, text }));
    }

    await this.xp.grantDailyCardXp(userId, type, sourceId, XP_PER_CARD);
    return { xpAwarded: XP_PER_CARD };
  }
}
