import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XpService } from '../xp/xp.service';
import { Exam } from './exam.entity';
import { ExamAttempt } from './exam-attempt.entity';
import { Question, QuestionType } from './question.entity';

/** A question as exposed to the client while taking the exam — never includes the answer key. */
export type PublicQuestion = Pick<
  Question,
  'id' | 'examId' | 'topic' | 'text' | 'code' | 'options' | 'type'
>;

/** Per-question grading, revealed only in the response to a submitted attempt. */
export interface QuestionReview {
  id: number;
  topic: string;
  type: QuestionType;
  given: string[];
  correctKeys: string[];
  correct: boolean;
  explanation: string | null;
  source: string | null;
}

export interface SubmitResult {
  id: number;
  examId: string;
  score: number;
  total: number;
  finishedAt: Date;
  answers: Record<number, string[]>;
  review: QuestionReview[];
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
    return this.examRepo.find({ order: { category: 'ASC', title: 'ASC' } });
  }

  getExam(id: string): Promise<Exam | null> {
    return this.examRepo.findOne({ where: { id } });
  }

  async getQuestions(examId: string, topic?: string, limit?: number): Promise<PublicQuestion[]> {
    const exam = await this.getExam(examId);
    const maxQuestions = exam?.questionCount ?? 50;
    const requestedLimit = Number.isFinite(limit) && limit && limit > 0 ? limit : maxQuestions;
    const questionLimit = Math.min(requestedLimit, maxQuestions);
    const qb = this.questionRepo.createQueryBuilder('q').where('q.examId = :examId', { examId });
    if (topic) qb.andWhere('q.topic = :topic', { topic });
    const questions = await qb.orderBy('RANDOM()').limit(questionLimit).getMany();
    return questions.map((q) => this.toPublic(q));
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

  async startAttempt(examId: string, userId?: number): Promise<ExamAttempt> {
    const attempt = this.attemptRepo.create({ examId, answers: {}, ...(userId ? { userId } : {}) });
    return this.attemptRepo.save(attempt);
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

    // Grade over the full set of shown questions when the client provides it
    // (so skipped questions count toward the total); otherwise fall back to the
    // answered ones for backward compatibility.
    const ids = [
      ...new Set((questionIds?.length ? questionIds : Object.keys(answers).map(Number)).filter(Number.isInteger)),
    ];
    const questions = ids.length ? await this.questionRepo.findBy(ids.map((qid) => ({ id: qid }))) : [];

    let score = 0;
    const review: QuestionReview[] = questions.map((q) => {
      const given = answers[q.id] ?? [];
      const correct = [...given].sort().join(',') === [...q.correctKeys].sort().join(',');
      if (correct) score++;
      return {
        id: q.id,
        topic: q.topic,
        type: q.type,
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
    attempt.finishedAt = new Date();
    const saved = await this.attemptRepo.save(attempt);

    if (attempt.userId) {
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

  getAttempts(examId: string, userId?: number | null): Promise<ExamAttempt[]> {
    if (!userId) return Promise.resolve([]);
    return this.attemptRepo.find({ where: { examId, userId }, order: { startedAt: 'DESC' } });
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
