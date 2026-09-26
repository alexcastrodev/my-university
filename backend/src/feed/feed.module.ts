import { Module } from '@nestjs/common';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { ReviewModule } from '../review/review.module';
import { XpModule } from '../xp/xp.module';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';

@Module({
  imports: [ReviewModule, CurriculumModule, XpModule],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
