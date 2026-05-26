import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XpModule } from '../xp/xp.module';
import { Exam } from './exam.entity';
import { ExamAttempt } from './exam-attempt.entity';
import { ExamController } from './exam.controller';
import { ExamService } from './exam.service';
import { Question } from './question.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Exam, Question, ExamAttempt]), XpModule],
  controllers: [ExamController],
  providers: [ExamService],
  exports: [ExamService],
})
export class ExamModule {}
