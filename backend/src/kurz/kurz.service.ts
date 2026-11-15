import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiAccessService } from '../ai/ai-access.service';
import { AiCreditsService } from '../ai/ai-credits.service';
import { AiUsageService, NoPriceError } from '../ai/ai-usage.service';
import { ConceptLookupService } from '../concept-lookup/concept-lookup.service';
import { DiscussionService } from '../discussion/discussion.service';
import {
  MAX_BODY_LENGTH,
  MAX_QUOTE_LENGTH,
} from '../discussion/discussion.logic';
import { Throttle } from '../papers/throttle';
import { Language } from '../shared/language';
import { returnedRows } from '../shared/sql';
import { KurzAnswer, KurzOutcome, validateAnswer } from './kurz-answer';
import { KurzModel, KurzUpstreamError } from './kurz-model';
import {
  buildInput,
  KURZ_PROMPT_VERSION,
  KURZ_SYSTEM_PROMPT,
  KurzTurn,
  responseSchema,
} from './kurz-prompt';
import { buildSources, selectionInPost } from './kurz-sources';
import {
  kurzEnabled,
  KURZ_RETENTION_DAYS,
  KURZ_TERMS_VERSION,
  kurzSettings,
} from './kurz.config';
import { AcceptTermsDto, AskKurzDto } from './kurz.dto';
import { TopicDto } from '../discussion/discussion.dto';

export type StoredOutcome = KurzOutcome | 'incomplete';

export interface MessageView {
  id: string;
  question: string;
  outcome: StoredOutcome;
  answer: KurzAnswer;
  helpful: boolean | null;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  anchorKey: string | null;
  blockIndex: number | null;
  selection: string | null;
  /** The post changed since this was asked: its paragraphs may not be where they were. */
  stale: boolean;
  updatedAt: string;
  messages: MessageView[];
}

export interface AskResult {
  conversationId: string;
  message: MessageView;
  /** What this question cost, and what is left. */
  credits: number;
  balance: number;
}

const EMPTY_ANSWER: KurzAnswer = {
  answerable: false,
  blocks: [],
  citations: [],
  see: [],
  followUps: [],
};

/** At most this many questions a minute from one student on one replica; the credit and the limit do the rest. */
const ASKS_PER_MINUTE = 6;
const PURGE_EVERY_MS = 6 * 3600 * 1000;
const MAX_CONVERSATIONS_PER_PAGE = 50;
/** How much of an earlier answer is given back to the model as context. */
const MAX_HISTORY_ANSWER_CHARS = 800;

const plain = (answer: KurzAnswer): string =>
  answer.blocks.map((b) => b.text).join('\n');

/**
 * The Kurz (#317). The order of what a question goes through is the one the issue fixes: the switch, the
 * permission (the route), the terms, the platform budget, the student's limit, the balance. Then one call to
 * the model, whose answer is shown only after `validateAnswer`, and billed from what the API reported.
 */
@Injectable()
export class KurzService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Kurz');
  private readonly asks = new Throttle(ASKS_PER_MINUTE, 60_000);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly lookup: ConceptLookupService,
    private readonly access: AiAccessService,
    private readonly usage: AiUsageService,
    private readonly credits: AiCreditsService,
    private readonly model: KurzModel,
    private readonly discussions: DiscussionService,
  ) {}

  onApplicationBootstrap() {
    void this.purge();
    this.timer = setInterval(() => void this.purge(), PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** The kill switch (and a model with no key): everything that asks or publishes stops with it. */
  enabled(): boolean {
    return kurzEnabled() && this.model.available();
  }

  assertEnabled(): void {
    if (!this.enabled())
      throw new ServiceUnavailableException({
        code: 'KURZ_DISABLED',
        message: 'The Kurz is off',
      });
  }

  // ---- terms and status ----

  async termsAccepted(userId: number): Promise<boolean> {
    const rows: { v: string | null }[] = await this.dataSource.query(
      `SELECT "aiTermsVersion" AS v FROM "user" WHERE id = $1`,
      [userId],
    );
    return rows[0]?.v === KURZ_TERMS_VERSION;
  }

  async acceptTerms(userId: number, dto: AcceptTermsDto): Promise<void> {
    if (!dto.adult || dto.version !== KURZ_TERMS_VERSION)
      throw new BadRequestException({
        code: 'TERMS_NOT_CONFIRMED',
        message: 'Confirm that you are 18 or older, in the current version',
      });
    await this.dataSource.query(
      `UPDATE "user" SET "aiTermsAcceptedAt" = now(), "aiTermsVersion" = $2 WHERE id = $1`,
      [userId, KURZ_TERMS_VERSION],
    );
  }

  /** Where the student stands: what they have, what blocks them, and whether the Kurz asks them for the terms. */
  async status(userId: number) {
    const [status, accepted] = await Promise.all([
      this.access.status(userId),
      this.termsAccepted(userId),
    ]);
    return {
      enabled: this.enabled(),
      termsVersion: KURZ_TERMS_VERSION,
      // The notice is shown the first time they try the Kurz with credit, not to someone who cannot ask yet.
      termsRequired: !accepted && status.balance > 0,
      ...status,
    };
  }

  // ---- asking ----

  private post(topic: TopicDto) {
    const source = this.lookup.resolveTopic(
      topic.module,
      topic.slug,
      topic.discipline,
    );
    if (!source) throw new NotFoundException();
    const detail = this.lookup.resolveConceptDetail(
      source.sourceType,
      source.sourceId,
      topic.lang as Language,
    );
    if (!detail) throw new NotFoundException();
    return {
      source,
      detail,
      topicKey: `${source.sourceType}:${source.sourceId}`,
    };
  }

  async ask(userId: number, dto: AskKurzDto): Promise<AskResult> {
    this.assertEnabled();
    const wait = this.asks.hit(userId);
    if (wait !== null)
      throw new HttpException(
        { statusCode: 429, code: 'RATE_LIMITED', retryAfter: wait },
        429,
      );

    const { source, detail, topicKey } = this.post(dto);
    const existing = dto.conversationId
      ? await this.ownConversation(
          userId,
          dto.conversationId,
          topicKey,
          dto.lang,
        )
      : null;

    if (!(await this.termsAccepted(userId)))
      throw new ForbiddenException({
        code: 'AI_TERMS_REQUIRED',
        message: 'Confirm the privacy notice and that you are 18 or older',
        termsVersion: KURZ_TERMS_VERSION,
      });
    const blocked = await this.access.check(userId);
    if (blocked)
      throw new HttpException(
        {
          statusCode: blocked.reason === 'NO_BALANCE' ? 402 : 429,
          code: blocked.reason,
          resetsAt: blocked.resetsAt,
        },
        blocked.reason === 'NO_BALANCE' ? 402 : 429,
      );

    const settings = kurzSettings();
    const related = this.lookup.resolveRelated(
      source.sourceType,
      source.sourceId,
      detail.related,
      dto.lang as Language,
      settings.maxRelated,
    );
    const sources = buildSources(
      { title: detail.title, route: detail.route, sections: detail.sections },
      related,
    );

    // A conversation keeps the context it started with; a new one takes it from the request.
    const askedSelection = existing
      ? existing.selection
      : (dto.selection ?? null);
    const focus = askedSelection
      ? selectionInPost(sources[0], askedSelection)
      : null;
    // A selection the post does not contain is just part of what the student wrote: never a source.
    const question =
      askedSelection && !focus
        ? `${dto.question}\n\n(The student wrote this text, it is not from the post: ${askedSelection})`
        : dto.question;
    const history = existing
      ? await this.history(existing.id, settings.historyTurns)
      : [];

    let pending: Awaited<ReturnType<AiUsageService['begin']>>;
    try {
      pending = await this.usage.begin(
        userId,
        settings.model,
        existing?.id ?? null,
      );
    } catch (error) {
      if (error instanceof NoPriceError)
        throw new ServiceUnavailableException({
          code: 'KURZ_UNAVAILABLE',
          message: 'The Kurz has no price for its model',
        });
      throw error;
    }

    let result: Awaited<ReturnType<KurzModel['ask']>>;
    try {
      result = await this.model.ask({
        model: settings.model,
        system: KURZ_SYSTEM_PROMPT,
        input: buildInput({
          lang: dto.lang,
          sources,
          selection:
            focus && askedSelection
              ? { text: askedSelection, p: focus.p }
              : null,
          history,
          question,
        }),
        schema: responseSchema(sources.map((s) => s.id)),
        thinkingLevel: settings.thinkingLevel,
        maxOutputTokens: settings.maxOutputTokens,
        timeoutMs: settings.timeoutMs,
        sources,
        question,
      });
    } catch (error) {
      await this.usage.finish(pending.id, 'error', null, pending.price, null);
      if (error instanceof KurzUpstreamError)
        throw new HttpException(
          {
            statusCode: error.timedOut ? 504 : 502,
            code: error.timedOut ? 'KURZ_TIMEOUT' : 'KURZ_UPSTREAM',
          },
          error.timedOut ? 504 : 502,
        );
      throw error;
    }

    if (result.status === 'blocked') {
      await this.usage.finish(pending.id, 'blocked', null, pending.price, null);
      throw new UnprocessableEntityException({ code: 'KURZ_BLOCKED' });
    }

    const incomplete = result.status === 'incomplete';
    // A cut-off answer is not trusted whatever it says: it may be an unfinished sentence that changes the sense.
    const validated = incomplete
      ? { answer: EMPTY_ANSWER, outcome: 'unverified' as const, dropped: 0 }
      : validateAnswer(result.text, sources);
    const outcome: StoredOutcome = incomplete
      ? 'incomplete'
      : validated.outcome;

    const charged = await this.usage.finish(
      pending.id,
      incomplete ? 'incomplete' : 'ok',
      result.usage,
      pending.price,
      result.raw,
    );
    this.log.log(
      `answered outcome=${outcome} dropped=${validated.dropped} credits=${charged.credits} input=${result.usage.input} output=${result.usage.output} thought=${result.usage.thought}`,
    );

    const stored = await this.dataSource.transaction(async (m) => {
      let conversationId = existing?.id;
      if (!conversationId) {
        const created: { id: string }[] = await m.query(
          `INSERT INTO kurz_conversation ("userId", "topicKey", lang, "anchorKey", "blockIndex", selection, "postVersion")
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            userId,
            topicKey,
            dto.lang,
            dto.anchorKey ?? null,
            dto.blockIndex ?? null,
            focus ? askedSelection : null,
            detail.version,
          ],
        );
        conversationId = created[0].id;
      }
      const message: { id: string; createdAt: Date }[] = await m.query(
        `INSERT INTO kurz_message ("conversationId", question, answer, outcome, model, "promptVersion")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, "createdAt"`,
        [
          conversationId,
          dto.question,
          JSON.stringify(validated.answer),
          outcome,
          settings.model,
          KURZ_PROMPT_VERSION,
        ],
      );
      await m.query(
        `UPDATE kurz_conversation SET "updatedAt" = now() WHERE id = $1`,
        [conversationId],
      );
      await m.query(`UPDATE ai_usage SET "conversationId" = $2 WHERE id = $1`, [
        pending.id,
        conversationId,
      ]);
      return { conversationId, message: message[0] };
    });

    return {
      conversationId: stored.conversationId,
      message: {
        id: stored.message.id,
        question: dto.question,
        outcome,
        answer: validated.answer,
        helpful: null,
        createdAt: new Date(stored.message.createdAt).toISOString(),
      },
      credits: charged.credits,
      balance: await this.credits.balance(userId),
    };
  }

  /** The student's own conversation on this page, or 404: someone else's id is indistinguishable from none. */
  private async ownConversation(
    userId: number,
    id: string,
    topicKey: string,
    lang: string,
  ): Promise<{ id: string; selection: string | null }> {
    const rows: { id: string; selection: string | null }[] =
      await this.dataSource.query(
        `SELECT id, selection FROM kurz_conversation WHERE id = $1 AND "userId" = $2 AND "topicKey" = $3 AND lang = $4`,
        [id, userId, topicKey, lang],
      );
    if (rows.length === 0) throw new NotFoundException();
    return rows[0];
  }

  /** The last answered exchanges, oldest first, as the model gets them back. */
  private async history(
    conversationId: string,
    turns: number,
  ): Promise<KurzTurn[]> {
    const rows: { question: string; answer: KurzAnswer }[] =
      await this.dataSource.query(
        `SELECT question, answer FROM kurz_message WHERE "conversationId" = $1 AND outcome = 'answered'
          ORDER BY "createdAt" DESC LIMIT $2`,
        [conversationId, turns],
      );
    return rows.reverse().map((r) => ({
      question: r.question,
      answer: plain(r.answer).slice(0, MAX_HISTORY_ANSWER_CHARS),
    }));
  }

  // ---- reading and erasing ----

  /** The student's conversations on one page, newest first, with their exchanges. Always scoped to the session user. */
  async conversations(
    userId: number,
    topic: TopicDto,
  ): Promise<ConversationView[]> {
    const { detail, topicKey } = this.post(topic);
    const convs: {
      id: string;
      anchorKey: string | null;
      blockIndex: number | null;
      selection: string | null;
      postVersion: string | null;
      updatedAt: Date;
    }[] = await this.dataSource.query(
      `SELECT id, "anchorKey", "blockIndex", selection, "postVersion", "updatedAt" FROM kurz_conversation
        WHERE "userId" = $1 AND "topicKey" = $2 AND lang = $3 ORDER BY "updatedAt" DESC LIMIT ${MAX_CONVERSATIONS_PER_PAGE}`,
      [userId, topicKey, topic.lang],
    );
    if (convs.length === 0) return [];
    const messages: (Omit<MessageView, 'createdAt' | 'id'> & {
      id: string;
      conversationId: string;
      createdAt: Date;
    })[] = await this.dataSource.query(
      `SELECT id, "conversationId", question, outcome, answer, helpful, "createdAt" FROM kurz_message
        WHERE "conversationId" = ANY($1) ORDER BY "createdAt"`,
      [convs.map((c) => c.id)],
    );
    return convs.map((c) => ({
      id: c.id,
      anchorKey: c.anchorKey,
      blockIndex: c.blockIndex,
      selection: c.selection,
      stale: c.postVersion !== detail.version,
      updatedAt: new Date(c.updatedAt).toISOString(),
      messages: messages
        .filter((m) => m.conversationId === c.id)
        .map((m) => ({
          id: m.id,
          question: m.question,
          outcome: m.outcome,
          answer: m.answer,
          helpful: m.helpful,
          createdAt: new Date(m.createdAt).toISOString(),
        })),
    }));
  }

  /**
   * Erases one conversation, or all of the student's. A report made from it stays, and loses the name: the
   * report is a copy that stands alone (it keeps the text), the conversation is not.
   */
  async deleteConversations(userId: number, id?: string): Promise<number> {
    return this.dataSource.transaction(async (m) => {
      const mine = id
        ? `SELECT m.id FROM kurz_message m JOIN kurz_conversation c ON c.id = m."conversationId" WHERE c.id = $2 AND c."userId" = $1`
        : `SELECT m.id FROM kurz_message m JOIN kurz_conversation c ON c.id = m."conversationId" WHERE c."userId" = $1`;
      const args = id ? [userId, id] : [userId];
      await m.query(
        `UPDATE ai_report SET "userId" = NULL WHERE "userId" = $1 AND "messageId" IN (${mine})`,
        args,
      );
      const deleted = returnedRows(
        await m.query(
          id
            ? `DELETE FROM kurz_conversation WHERE id = $2 AND "userId" = $1 RETURNING id`
            : `DELETE FROM kurz_conversation WHERE "userId" = $1 RETURNING id`,
          args,
        ),
      );
      if (id && deleted.length === 0) throw new NotFoundException();
      return deleted.length;
    });
  }

  /** The retention: a conversation goes 90 days after its last message. Idempotent, so both replicas may run it. */
  async purge(): Promise<number> {
    try {
      const old = `SELECT m.id FROM kurz_message m JOIN kurz_conversation c ON c.id = m."conversationId"
                    WHERE c."updatedAt" < now() - interval '${KURZ_RETENTION_DAYS} days'`;
      await this.dataSource.query(
        `UPDATE ai_report SET "userId" = NULL WHERE "userId" IS NOT NULL AND "messageId" IN (${old})`,
      );
      const deleted = returnedRows(
        await this.dataSource.query(
          `DELETE FROM kurz_conversation WHERE "updatedAt" < now() - interval '${KURZ_RETENTION_DAYS} days' RETURNING id`,
        ),
      );
      if (deleted.length > 0)
        this.log.log(`purged ${deleted.length} conversations`);
      return deleted.length;
    } catch (error) {
      this.log.warn(`purge failed: ${(error as Error).message}`);
      return 0;
    }
  }

  // ---- what the student does with an answer ----

  private async ownMessage(userId: number, messageId: string) {
    const rows: {
      id: string;
      question: string;
      answer: KurzAnswer;
      outcome: StoredOutcome;
      model: string;
      promptVersion: number;
      conversationId: string;
      topicKey: string;
      lang: string;
      anchorKey: string | null;
      blockIndex: number | null;
      selection: string | null;
      postVersion: string | null;
    }[] = await this.dataSource.query(
      `SELECT m.id, m.question, m.answer, m.outcome, m.model, m."promptVersion", m."conversationId",
              c."topicKey", c.lang, c."anchorKey", c."blockIndex", c.selection, c."postVersion"
         FROM kurz_message m JOIN kurz_conversation c ON c.id = m."conversationId"
        WHERE m.id = $1 AND c."userId" = $2`,
      [messageId, userId],
    );
    if (rows.length === 0) throw new NotFoundException();
    return rows[0];
  }

  async feedback(
    userId: number,
    messageId: string,
    helpful: boolean,
  ): Promise<void> {
    const rows = returnedRows(
      await this.dataSource.query(
        `UPDATE kurz_message m SET helpful = $3 FROM kurz_conversation c
          WHERE m.id = $2 AND c.id = m."conversationId" AND c."userId" = $1 RETURNING m.id`,
        [userId, messageId, helpful],
      ),
    );
    if (rows.length === 0) throw new NotFoundException();
  }

  /** "Report a wrong answer": a copy of the exchange for the team. Once per exchange; asking again changes nothing. */
  async report(
    userId: number,
    messageId: string,
    note?: string,
  ): Promise<void> {
    const m = await this.ownMessage(userId, messageId);
    await this.dataSource.query(
      `INSERT INTO ai_report ("userId", "messageId", "topicKey", lang, "postVersion", selection, question, answer, model, "promptVersion", note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT ("messageId") DO NOTHING`,
      [
        userId,
        messageId,
        m.topicKey,
        m.lang,
        m.postVersion,
        m.selection,
        m.question,
        JSON.stringify(m.answer),
        m.model,
        m.promptVersion,
        note?.trim() || null,
      ],
    );
  }

  /**
   * "Share in the discussion": the question and the answer of that one exchange, as a post labelled as the
   * Kurz's, under the paragraph it was about (the end of the page for a whole-post conversation). The text is
   * built here from what was stored, never taken from the client, so it cannot be made to say anything else.
   */
  async share(userId: number, messageId: string): Promise<{ body: string }> {
    this.assertEnabled();
    const m = await this.ownMessage(userId, messageId);
    if (m.outcome !== 'answered')
      throw new BadRequestException({ code: 'NOTHING_TO_SHARE' });
    const body = shareBody(m.question, m.answer);
    const named = this.lookup.topicOfKey(m.topicKey);
    if (!named) throw new NotFoundException();
    const topic = { ...named, lang: m.lang };
    // The quote that anchors the thread must be text of the post: the selection, or what the answer cited.
    const quote = (m.selection ?? m.answer.citations[0]?.quote ?? '').slice(
      0,
      MAX_QUOTE_LENGTH,
    );
    if (m.anchorKey !== null && m.blockIndex !== null)
      await this.discussions.createThread(userId, {
        ...topic,
        anchorKey: m.anchorKey,
        blockIndex: m.blockIndex,
        quote,
        body,
      });
    else await this.discussions.createGeneralPost(userId, { ...topic, body });
    return { body };
  }
}

/** The text published for an exchange. `@` is broken after: an answer about annotations must not notify a user. */
export function shareBody(question: string, answer: KurzAnswer): string {
  const label = 'Resposta do Kurz (IA)';
  // Only the cited blocks: a `question` block is the one text the model wrote with nothing to check it against,
  // so it stays in the student's private conversation and never reaches the public discussion.
  const cited = answer.blocks.filter((b) => b.kind !== 'question');
  const text =
    `${question}\n\n${label}:\n${plain({ ...answer, blocks: cited })}`.replace(
      /@(?=\w)/g,
      '@​',
    );
  return text.length <= MAX_BODY_LENGTH
    ? text
    : `${text.slice(0, MAX_BODY_LENGTH - 1)}…`;
}
