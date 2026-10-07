import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { ReviewModule } from '../review/review.module';
import { DiscussionComment } from './discussion-comment.entity';
import { DiscussionController } from './discussion.controller';
import { DiscussionMarker } from './discussion-marker.entity';
import { DiscussionService } from './discussion.service';
import { DiscussionVote } from './discussion-vote.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DiscussionMarker,
      DiscussionComment,
      DiscussionVote,
      User,
    ]),
    ReviewModule,
  ],
  controllers: [DiscussionController],
  providers: [DiscussionService],
})
export class DiscussionModule {}
