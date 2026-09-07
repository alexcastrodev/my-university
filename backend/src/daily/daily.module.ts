import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewModule } from '../review/review.module';
import { XpModule } from '../xp/xp.module';
import { DailyWriteAnswer } from './daily-write-answer.entity';
import { DailyController } from './daily.controller';
import { DailyService } from './daily.service';

@Module({
  imports: [TypeOrmModule.forFeature([DailyWriteAnswer]), ReviewModule, XpModule],
  controllers: [DailyController],
  providers: [DailyService],
})
export class DailyModule {}
