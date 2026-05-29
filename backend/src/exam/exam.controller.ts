import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { OptionalUserId } from '../auth/session';
import { ExamService } from './exam.service';

@Controller('exam')
export class ExamController {
  constructor(private service: ExamService) {}

  @Get('list')
  listExams() {
    return this.service.listExams();
  }

  @Get(':examId')
  getExam(@Param('examId') examId: string) {
    return this.service.getExam(examId);
  }

  @Get(':examId/topics')
  getTopics(@Param('examId') examId: string) {
    return this.service.getTopics(examId);
  }

  @Get(':examId/stats')
  stats(@Param('examId') examId: string) {
    return this.service.countByTopic(examId);
  }

  @Get(':examId/questions')
  getQuestions(
    @Param('examId') examId: string,
    @Query('topic') topic?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getQuestions(examId, topic, limit ? parseInt(limit) : undefined);
  }

  @Get('questions/:id')
  getQuestion(@Param('id', ParseIntPipe) id: number) {
    return this.service.getQuestion(id);
  }

  @Post(':examId/attempts')
  start(@Param('examId') examId: string, @OptionalUserId() userId: number | null) {
    return this.service.startAttempt(examId, userId ?? undefined);
  }

  @Post('attempts/:id/submit')
  submit(
    @Param('id', ParseIntPipe) id: number,
    @OptionalUserId() userId: number | null,
    @Body('answers') answers: Record<number, string[]>,
    @Body('questionIds') questionIds?: number[],
  ) {
    return this.service.submitAttempt(id, answers ?? {}, questionIds, userId);
  }

  @Get(':examId/attempts')
  getAttempts(@Param('examId') examId: string, @OptionalUserId() userId: number | null) {
    return this.service.getAttempts(examId, userId);
  }
}
