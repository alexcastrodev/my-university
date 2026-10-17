import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XpService } from '../xp/xp.service';
import { Exam } from './exam.entity';
import { ExamAttempt, QuestionReview } from './exam-attempt.entity';
import { Question } from './question.entity';

/** A question as exposed to the client while taking the exam — never includes the answer key. */
export type PublicQuestion = Pick<
  Question,
  'id' | 'examId' | 'topic' | 'text' | 'code' | 'options' | 'type'
>;

export interface SubmitResult {
  id: number;
  examId: string;
  score: number;
  total: number;
  finishedAt: Date;
  answers: Record<number, string[]>;
  review: QuestionReview[];
}

/** History-list shape — the fields returned by getAttempts(), omitting answers/review. */
export type AttemptSummary = Pick<ExamAttempt, 'id' | 'examId' | 'startedAt' | 'finishedAt' | 'score' | 'total'>;

/**
 * Trimmed, safe-to-publish shape for a shareable attempt link. Deliberately omits
 * `answers`/`review` (would expose actual certification question content publicly).
 */
export interface PublicAttemptSummary {
  examTitle: string;
  score: number;
  total: number;
  passingScore: number;
  passed: boolean;
  finishedAt: Date | null;
}

@Injectable()
export class ExamService {
  constructor(
    @InjectRepository(Exam) private examRepo: Repository<Exam>,
    @InjectRepository(Question) private questionRepo: Repository<Question>,
    @InjectRepository(ExamAttempt) private attemptRepo: Repository<ExamAttempt>,
    private xpService: XpService,
  ) {}

  listExams(): Promise<Exam[]> {
    return this.examRepo.find({ order: { title: 'ASC' } });
  }

  getExam(id: string): Promise<Exam | null> {
    return this.examRepo.findOne({ where: { id } });
  }

  async getQuestions(examId: string, topic?: string, limit?: number): Promise<PublicQuestion[]> {
    return (await this.sampleQuestions(examId, topic, limit)).map((q) => this.toPublic(q));
  }

  private async sampleQuestions(examId: string, topic?: string, limit?: number): Promise<Question[]> {
    const exam = await this.getExam(examId);
    const maxQuestions = exam?.questionCount ?? 50;
    const requestedLimit = Number.isFinite(limit) && limit && limit > 0 ? limit : maxQuestions;
    const questionLimit = Math.min(requestedLimit, maxQuestions);
    const qb = this.questionRepo.createQueryBuilder('q').where('q.examId = :examId', { examId });
    if (topic) qb.andWhere('q.topic = :topic', { topic });
    return qb.orderBy('RANDOM()').limit(questionLimit).getMany();
  }

  async getQuestion(id: number): Promise<PublicQuestion | null> {
    const question = await this.questionRepo.findOne({ where: { id } });
    return question ? this.toPublic(question) : null;
  }

  /** Strips the answer key (correctKeys/explanation/source) before sending a question to the client. */
  private toPublic(q: Question): PublicQuestion {
    return {
      id: q.id,
      examId: q.examId,
      topic: q.topic,
      text: q.text,
      code: q.code,
      options: q.options,
      type: q.type,
    };
  }

  /**
   * With `serve`, the server draws the questions and remembers them on the attempt: that list, not
   * anything the client reports later, is what gets graded and what can earn XP. Without it (older
   * clients) the attempt is still gradable but never pays XP.
   */
  async startAttempt(
    examId: string,
    userId?: number,
    serve?: { topic?: string; limit?: number },
  ): Promise<ExamAttempt & { questions?: PublicQuestion[] }> {
    const questions = serve ? await this.sampleQuestions(examId, serve.topic, serve.limit) : undefined;
    if (serve && !(await this.getExam(examId))) throw new NotFoundException();
    const attempt = this.attemptRepo.create({
      examId,
      answers: {},
      questionIds: questions ? questions.map((q) => q.id) : null,
      ...(userId ? { userId } : {}),
    });
    const saved = await this.attemptRepo.save(attempt);
    return questions ? { ...saved, questions: questions.map((q) => this.toPublic(q)) } : saved;
  }

  async submitAttempt(
    id: number,
    answers: Record<number, string[]>,
    questionIds?: number[],
    requesterId?: number | null,
  ): Promise<SubmitResult> {
    const attempt = await this.attemptRepo.findOneOrFail({ where: { id } });

    // An attempt that belongs to a user can only be submitted by that same user.
    // Anonymous attempts (no owner) remain submittable by anyone.
    if (attempt.userId != null && attempt.userId !== requesterId) {
      throw new ForbiddenException();
    }

    // A finished attempt is a closed record: re-submitting it would let a reader keep re-grading
    // (and overwrite their XP entry) until a lucky answer set sticks.
    if (attempt.finishedAt) throw new ConflictException('Attempt already submitted');

    // A served attempt is graded over exactly the questions the server drew for it. Only an
    // attempt without a served list (a client that predates it) falls back to the ids the client
    // reports, which are bounded and restricted to this exam, and which can never pay XP.
    const served = attempt.questionIds;
    const ids = served ?? [
      ...new Set((questionIds?.length ? questionIds : Object.keys(answers).map(Number)).filter(Number.isInteger)),
    ];
    // An exam never serves more than `questionCount`; an unbounded array would turn into one huge IN query.
    const exam = await this.getExam(attempt.examId);
    if (ids.length > (exam?.questionCount ?? 50)) throw new BadRequestException('Too many questions');
    // Only this exam's questions count: ids of other exams must not inflate (or probe) this attempt.
    const byId = new Map(
      (ids.length ? await this.questionRepo.findBy(ids.map((qid) => ({ id: qid }))) : [])
        .filter((q) => q.examId === attempt.examId)
        .map((q) => [q.id, q] as const),
    );
    const questions = ids.flatMap((qid) => byId.get(qid) ?? []);

    let score = 0;
    const review: QuestionReview[] = questions.map((q) => {
      const given = Array.isArray(answers[q.id]) ? answers[q.id] : [];
      const correct = [...given].sort().join(',') === [...q.correctKeys].sort().join(',');
      if (correct) score++;
      return {
        id: q.id,
        topic: q.topic,
        type: q.type,
        text: q.text,
        code: q.code,
        options: q.options,
        given,
        correctKeys: q.correctKeys,
        correct,
        explanation: q.explanation,
        source: q.source,
      };
    });

    attempt.answers = answers;
    attempt.score = score;
    attempt.total = questions.length;
    attempt.review = review;
    attempt.finishedAt = new Date();
    const saved = await this.attemptRepo.save(attempt);

    if (attempt.userId && served) {
      await this.xpService.grantSkillCheckXp(attempt.userId, attempt.examId, score, questions.length);
    }

    return {
      id: saved.id,
      examId: saved.examId,
      score: saved.score,
      total: saved.total,
      finishedAt: saved.finishedAt,
      answers: saved.answers,
      review,
    };
  }

  /** Lightweight history list — omits `answers`/`review`, which can be large and aren't needed to render a list. */
  getAttempts(examId: string, userId?: number | null): Promise<AttemptSummary[]> {
    if (!userId) return Promise.resolve([]);
    return this.attemptRepo.find({
      where: { examId, userId },
      order: { startedAt: 'DESC' },
      select: { id: true, examId: true, startedAt: true, finishedAt: true, score: true, total: true },
    });
  }

  async getAttempt(examId: string, id: number, requesterId?: number | null): Promise<ExamAttempt | null> {
    const attempt = await this.attemptRepo.findOne({ where: { id, examId } });
    if (!attempt) return null;

    // Same rule as submitAttempt: an owned attempt can only be read back by its owner.
    if (attempt.userId != null && attempt.userId !== requesterId) {
      throw new ForbiddenException();
    }

    return attempt;
  }

  /**
   * Public, unauthenticated summary for a shareable attempt link. Not gated by ownership —
   * anyone with the link can view this trimmed subset — but only once the attempt is finished
   * (an in-progress attempt shouldn't be shareable).
   */
  async getPublicAttemptSummary(examId: string, id: number): Promise<PublicAttemptSummary | null> {
    const attempt = await this.attemptRepo.findOne({ where: { id, examId } });
    if (!attempt || !attempt.finishedAt) return null;

    const exam = await this.getExam(examId);
    if (!exam) return null;

    const percent = attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0;
    const passed = attempt.total > 0 && percent >= exam.passingScore;

    return {
      examTitle: exam.title,
      score: attempt.score,
      total: attempt.total,
      passingScore: exam.passingScore,
      passed,
      finishedAt: attempt.finishedAt,
    };
  }

  getTopics(examId: string): Promise<string[]> {
    return this.questionRepo
      .createQueryBuilder('q')
      .select('DISTINCT q.topic', 'topic')
      .where('q.examId = :examId', { examId })
      .getRawMany()
      .then((rows) => rows.map((r) => r.topic));
  }

  countByTopic(examId: string): Promise<{ topic: string; count: number }[]> {
    return this.questionRepo
      .createQueryBuilder('q')
      .select('q.topic', 'topic')
      .addSelect('COUNT(*)', 'count')
      .where('q.examId = :examId', { examId })
      .groupBy('q.topic')
      .getRawMany();
  }
}
