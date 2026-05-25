import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ExamService } from './exam.service';

@Controller('exam')
export class ExamController {
  constructor(private service: ExamService) {}

  @Get('list')
  listExams() {
    return this.service.listExams();
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
    return this.service.getQuestions(examId, topic, limit ? parseInt(limit) : 50);
  }

  @Get('questions/:id')
  getQuestion(@Param('id', ParseIntPipe) id: number) {
    return this.service.getQuestion(id);
  }

  @Post(':examId/attempts')
  start(@Param('examId') examId: string) {
    return this.service.startAttempt(examId);
  }

  @Post('attempts/:id/submit')
  submit(
    @Param('id', ParseIntPipe) id: number,
    @Body('answers') answers: Record<number, string[]>,
  ) {
    return this.service.submitAttempt(id, answers);
  }

  @Get(':examId/attempts')
  getAttempts(@Param('examId') examId: string) {
    return this.service.getAttempts(examId);
  }
}
