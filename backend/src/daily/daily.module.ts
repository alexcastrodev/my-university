import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConceptLookupModule } from '../concept-lookup/concept-lookup.module';
import { XpModule } from '../xp/xp.module';
import { DailyWriteAnswer } from './daily-write-answer.entity';
import { DailyController } from './daily.controller';
import { DailyService } from './daily.service';

@Module({
  imports: [TypeOrmModule.forFeature([DailyWriteAnswer]), ConceptLookupModule, XpModule],
  controllers: [DailyController],
  providers: [DailyService],
})
export class DailyModule {}
