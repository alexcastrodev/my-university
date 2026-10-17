import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XpModule } from '../xp/xp.module';
import { User } from '../auth/user.entity';
import { Lesson } from '../lesson/lesson.entity';
import { ProgressController } from './progress.controller';
import { Progress } from './progress.entity';
import { ProgressService } from './progress.service';

@Module({
  imports: [TypeOrmModule.forFeature([Progress, User, Lesson]), XpModule],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
