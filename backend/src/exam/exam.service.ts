import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exam } from './exam.entity';
import { ExamAttempt } from './exam-attempt.entity';
import { Question } from './question.entity';

@Injectable()
export class ExamService {
  constructor(
    @InjectRepository(Exam) private examRepo: Repository<Exam>,
    @InjectRepository(Question) private questionRepo: Repository<Question>,
    @InjectRepository(ExamAttempt) private attemptRepo: Repository<ExamAttempt>,
  ) {}

  listExams(): Promise<Exam[]> {
    return this.examRepo.find({ order: { category: 'ASC', title: 'ASC' } });
  }

  getExam(id: string): Promise<Exam | null> {
    return this.examRepo.findOne({ where: { id } });
  }

  getQuestions(examId: string, topic?: string, limit = 50): Promise<Question[]> {
    const qb = this.questionRepo.createQueryBuilder('q').where('q.examId = :examId', { examId });
    if (topic) qb.andWhere('q.topic = :topic', { topic });
    return qb.orderBy('RANDOM()').limit(limit).getMany();
  }

  getQuestion(id: number): Promise<Question | null> {
    return this.questionRepo.findOne({ where: { id } });
  }

  async startAttempt(examId: string): Promise<ExamAttempt> {
    const attempt = this.attemptRepo.create({ examId, answers: {} });
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
    return this.attemptRepo.save(attempt);
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
