import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewSourceType } from '../review/review-schedule.entity';
import { fromSourceId, parseCurriculumSourceId } from '../review/review.constants';
import { ReviewService } from '../review/review.service';
import { ReviewRating } from '../review/sm2';
import { DEFAULT_LANGUAGE, Language } from '../shared/language';
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
  /** Area the concept lives in (`java-concepts`, or a CS module like `foundations`), for the card's breadcrumb. */
  module: string;
  /** What the flashcard reveals once flipped: the concept's own opening prose, never authored separately. */
  answer?: string;
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
  module?: string;
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
  module?: string;
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

/** The area a history entry belongs to (`spring-concepts`, or a CS module like `foundations`), for card breadcrumbs. */
function moduleOf(sourceType: ReviewSourceType, sourceId: string): string | undefined {
  return parseCurriculumSourceId(sourceId)?.module ?? fromSourceId(sourceType, sourceId)?.module;
}

function formatDate(date: Date, lang: Language): string {
  return date
    .toLocaleDateString(lang === 'pt-BR' ? 'pt-BR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    .toUpperCase();
}

/** Every piece of prose the session builder writes itself (as opposed to excerpting from a
 *  concept, which `ReviewService.resolveConceptDetail` already serves per language). */
const STRINGS = {
  en: {
    recallSubtitle: 'Marked "Got it" earlier',
    recallRecap: (title: string) => `Recall · ${title}`,
    recallKicker: 'RECALL · NO LOOKING BACK',
    recallContext: (title: string) => `You marked "${title}" as "Got it" before. Does it still hold?`,
    wrongNote:
      'Getting it wrong is not a penalty. It reopens the topic and puts it back in a future session.',
    readSubtitle: 'From what you read recently',
    readRecap: (title: string) => `Read · ${title}`,
    readKicker: 'READ · ONE SCREEN',
    readNote: 'This is the whole card. The full topic has more.',
    noticeSubtitle: 'A real snippet from what you read',
    noticeRecap: (title: string) => `Notice · ${title}`,
    noticeKicker: 'NOTICE · FROM THE REAL SOURCE',
    noticeTakeawayLabel: 'NOTE',
    writeSubtitle: 'One line, in your own words',
    writeRecap: (title: string) => `Write · ${title}`,
    writeKicker: 'WRITE · ONE LINE',
    writeTitle: (title: string) => `In your own words: what's the core idea behind "${title}"?`,
    writeHint: 'One or two sentences is enough',
    writePastWhen: (date: string) => `YOU WROTE ON ${date}`,
    writePastNote: 'Both answers are kept. Neither replaces the other.',
    writeFootnote: (xp: number) => `Saving this adds ${xp} XP.`,
    emptyHeadline: 'Nothing to review yet',
    emptyTomorrowTitle: 'Read one concept first',
    emptyTomorrowBody: 'Once you mark something as read, a session assembles itself from it.',
    builtFrom: (title: string) => `Built from "${title}"`,
    todaysSession: "Today's session",
    tomorrowTitle: 'Assembled fresh next time',
    tomorrowBody:
      'Nothing is scheduled. The session is built from what you last read and what is due when you open it.',
  },
  'pt-BR': {
    recallSubtitle: 'Marcado como "Entendi" antes',
    recallRecap: (title: string) => `Lembrar · ${title}`,
    recallKicker: 'LEMBRAR · SEM OLHAR',
    recallContext: (title: string) =>
      `Você marcou "${title}" como "Entendi" antes. Ainda está de pé?`,
    wrongNote:
      'Errar não é penalidade. O tópico é reaberto e volta numa sessão futura.',
    readSubtitle: 'Do que você leu há pouco',
    readRecap: (title: string) => `Leitura · ${title}`,
    readKicker: 'LEITURA · UMA TELA',
    readNote: 'Este é o card inteiro. O tópico completo tem mais.',
    noticeSubtitle: 'Um trecho real do que você leu',
    noticeRecap: (title: string) => `Observar · ${title}`,
    noticeKicker: 'OBSERVAR · DA FONTE REAL',
    noticeTakeawayLabel: 'NOTA',
    writeSubtitle: 'Uma linha, com suas palavras',
    writeRecap: (title: string) => `Escrever · ${title}`,
    writeKicker: 'ESCREVER · UMA LINHA',
    writeTitle: (title: string) => `Com suas palavras: qual é a ideia central de "${title}"?`,
    writeHint: 'Uma ou duas frases bastam',
    writePastWhen: (date: string) => `VOCÊ ESCREVEU EM ${date}`,
    writePastNote: 'As duas respostas ficam guardadas. Nenhuma substitui a outra.',
    writeFootnote: (xp: number) => `Salvar isto adiciona ${xp} XP.`,
    emptyHeadline: 'Nada para revisar ainda',
    emptyTomorrowTitle: 'Leia um conceito primeiro',
    emptyTomorrowBody: 'Assim que você marcar algo como lido, uma sessão se monta a partir disso.',
    builtFrom: (title: string) => `Montada a partir de "${title}"`,
    todaysSession: 'Sessão de hoje',
    tomorrowTitle: 'Montada do zero na próxima vez',
    tomorrowBody:
      'Nada fica agendado. A sessão é montada a partir do que você leu por último e do que está pendente quando você abre.',
  },
} satisfies Record<Language, unknown>;

type Strings = (typeof STRINGS)[Language];

@Injectable()
export class DailyService {
  constructor(
    private review: ReviewService,
    private xp: XpService,
    @InjectRepository(DailyWriteAnswer) private writeAnswers: Repository<DailyWriteAnswer>,
  ) {}

  async buildSession(userId: number, lang: Language = DEFAULT_LANGUAGE): Promise<DailySessionDto> {
    const t = STRINGS[lang];
    const recall = await this.buildRecallCard(userId, lang);

    const rawHistory = await this.xp.getHistory(userId, HISTORY_LOOKBACK);
    const history = rawHistory.filter(
      (entry): entry is typeof entry & { sourceType: ReviewSourceType } =>
        entry.sourceType === 'concept-read' || entry.sourceType === 'episode-watched',
    );
    const readEntry = this.pickReadEntry(history, recall?.sourceId, lang);
    const readCard = readEntry ? this.buildReadCard(readEntry, t) : null;

    const noticeEntry = readEntry
      ? this.pickNoticeEntry(history, readEntry.sourceId, lang) ?? readEntry
      : null;
    const noticeCard = noticeEntry ? this.buildNoticeCard(noticeEntry, t) : null;

    const writeCard = readCard ? await this.buildWriteCard(userId, readCard, lang) : null;

    const cards: DailyCardDto[] = [recall, readCard, noticeCard, writeCard].filter(
      (c): c is DailyCardDto => c !== null,
    );

    return {
      estimatedMinutes: Math.max(1, cards.length),
      cards,
      summary: this.buildSummary(cards, t),
    };
  }

  private async buildRecallCard(userId: number, lang: Language): Promise<RecallCardDto | null> {
    const t = STRINGS[lang];
    const due = await this.review.getDueQueue(userId);
    if (due.length === 0) return null;
    const item = due[0];

    const detail = this.review.resolveConceptDetail(item.sourceType, item.sourceId, lang);
    const section = detail ? firstSubstantialSection(detail.sections) : null;
    const answer = section ? excerptParagraphs(section.content, 1) : '';
    // The due queue only knows the English title; the resolved detail has the translated one.
    const title = detail?.title ?? item.title;

    return {
      type: 'recall',
      xp: XP_PER_CARD,
      previewTitle: title,
      previewSubtitle: t.recallSubtitle,
      recap: t.recallRecap(title),
      kicker: t.recallKicker,
      title,
      context: t.recallContext(title),
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      route: item.route,
      wrongNote: t.wrongNote,
      module: item.module,
      answer: answer || undefined,
    };
  }

  /** Most recent read-history entry whose content resolves and is substantial, excluding
   *  whatever sourceId Recall already used (so the session doesn't repeat one concept twice). */
  private pickReadEntry(
    history: { sourceType: ReviewSourceType; sourceId: string; updatedAt: Date }[],
    excludeSourceId: string | undefined,
    lang: Language,
  ): { sourceType: ReviewSourceType; sourceId: string; title: string; sections: { title: string; content: string }[]; route: string[] } | null {
    for (const entry of history) {
      if (entry.sourceId === excludeSourceId) continue;
      const detail = this.review.resolveConceptDetail(entry.sourceType, entry.sourceId, lang);
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
    lang: Language,
  ): { sourceType: ReviewSourceType; sourceId: string; title: string; sections: { title: string; content: string }[]; route: string[] } | null {
    for (const entry of history) {
      if (entry.sourceId === excludeSourceId) continue;
      const detail = this.review.resolveConceptDetail(entry.sourceType, entry.sourceId, lang);
      if (!detail) continue;
      if (!firstSectionWithCode(detail.sections)) continue;
      return { sourceType: entry.sourceType, sourceId: entry.sourceId, ...detail };
    }
    return null;
  }

  private buildReadCard(entry: {
    sourceType: ReviewSourceType;
    sourceId: string;
    title: string;
    sections: { title: string; content: string }[];
    route: string[];
  }, t: Strings): ReadCardDto | null {
    const section = firstSubstantialSection(entry.sections);
    if (!section) return null;

    const body = excerptParagraphs(section.content, 2);
    const code = firstCodeBlock(section.content);

    return {
      type: 'read',
      xp: XP_PER_CARD,
      previewTitle: entry.title,
      previewSubtitle: t.readSubtitle,
      recap: t.readRecap(entry.title),
      kicker: t.readKicker,
      breadcrumb: entry.title,
      title: entry.title,
      body,
      code: code
        ? { header: entry.title.toUpperCase(), source: code.code }
        : undefined,
      note: t.readNote,
      fullTopicRoute: entry.route,
      sourceId: entry.sourceId,
      module: moduleOf(entry.sourceType, entry.sourceId),
    };
  }

  private buildNoticeCard(entry: {
    sourceType: ReviewSourceType;
    sourceId: string;
    title: string;
    sections: { title: string; content: string }[];
  }, t: Strings): NoticeCardDto | null {
    const section = firstSectionWithCode(entry.sections) ?? entry.sections.find((s) => firstCodeBlock(s.content));
    if (!section) return null;
    const code = firstCodeBlock(section.content);
    if (!code) return null;

    const after = textAfterCodeBlock(section.content, 2);

    return {
      type: 'notice',
      xp: XP_PER_CARD,
      previewTitle: entry.title,
      previewSubtitle: t.noticeSubtitle,
      recap: t.noticeRecap(entry.title),
      kicker: t.noticeKicker,
      title: entry.title,
      code: { header: entry.title.toUpperCase(), source: code.code },
      lead: after[0],
      takeawayLabel: after[1] ? t.noticeTakeawayLabel : undefined,
      takeaway: after[1],
      sourceId: entry.sourceId,
      module: moduleOf(entry.sourceType, entry.sourceId),
    };
  }

  private async buildWriteCard(
    userId: number,
    readCard: ReadCardDto,
    lang: Language,
  ): Promise<WriteCardDto> {
    const t = STRINGS[lang];
    const previous = await this.writeAnswers.findOne({
      where: { userId, sourceId: readCard.sourceId },
      order: { createdAt: 'DESC' },
    });

    return {
      type: 'write',
      xp: XP_PER_CARD,
      previewTitle: readCard.title,
      previewSubtitle: t.writeSubtitle,
      recap: t.writeRecap(readCard.title),
      kicker: t.writeKicker,
      title: t.writeTitle(readCard.title),
      placeholderHint: t.writeHint,
      maxLength: WRITE_MAX_LENGTH,
      pastAnswer: previous
        ? {
            when: t.writePastWhen(formatDate(previous.createdAt, lang)),
            text: previous.text,
            note: t.writePastNote,
          }
        : undefined,
      footnote: t.writeFootnote(XP_PER_CARD),
      sourceId: readCard.sourceId,
    };
  }

  private buildSummary(cards: DailyCardDto[], t: Strings): DailySessionDto['summary'] {
    if (cards.length === 0) {
      return {
        headline: t.emptyHeadline,
        tomorrow: { title: t.emptyTomorrowTitle, body: t.emptyTomorrowBody },
      };
    }
    const readCard = cards.find((c): c is ReadCardDto => c.type === 'read');
    return {
      headline: readCard ? t.builtFrom(readCard.title) : t.todaysSession,
      tomorrow: { title: t.tomorrowTitle, body: t.tomorrowBody },
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
