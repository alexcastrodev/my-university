import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XpService } from '../xp/xp.service';
import { Exam } from './exam.entity';
import { ExamAttempt } from './exam-attempt.entity';
import { Question } from './question.entity';

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

  async getQuestions(examId: string, topic?: string, limit?: number): Promise<Question[]> {
    const exam = await this.getExam(examId);
    const maxQuestions = exam?.questionCount ?? 50;
    const requestedLimit = Number.isFinite(limit) && limit && limit > 0 ? limit : maxQuestions;
    const questionLimit = Math.min(requestedLimit, maxQuestions);
    const qb = this.questionRepo.createQueryBuilder('q').where('q.examId = :examId', { examId });
    if (topic) qb.andWhere('q.topic = :topic', { topic });
    return qb.orderBy('RANDOM()').limit(questionLimit).getMany();
  }

  getQuestion(id: number): Promise<Question | null> {
    return this.questionRepo.findOne({ where: { id } });
  }

  async startAttempt(examId: string, userId?: number): Promise<ExamAttempt> {
    const attempt = this.attemptRepo.create({ examId, answers: {}, ...(userId ? { userId } : {}) });
    return this.attemptRepo.save(attempt);
  }

  async submitAttempt(
    id: number,
    answers: Record<number, string[]>,
  ): Promise<ExamAttempt> {
    const attempt = await this.attemptRepo.findOneOrFail({ where: { id } });
    const questionIds = Object.keys(answers).map(Number);
    const questions = await this.questionRepo.findBy(
      questionIds.map((qid) => ({ id: qid })),
    );

    let score = 0;
    for (const q of questions) {
      const given = (answers[q.id] ?? []).sort().join(',');
      const correct = [...q.correctKeys].sort().join(',');
      if (given === correct) score++;
    }

    attempt.answers = answers;
    attempt.score = score;
    attempt.total = questions.length;
    attempt.finishedAt = new Date();
    const saved = await this.attemptRepo.save(attempt);

    if (attempt.userId) {
      await this.xpService.grantSkillCheckXp(attempt.userId, attempt.examId, score, questions.length);
    }

    return saved;
  }

  getAttempts(examId: string): Promise<ExamAttempt[]> {
    return this.attemptRepo.find({ where: { examId }, order: { startedAt: 'DESC' } });
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
