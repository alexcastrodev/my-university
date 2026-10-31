import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { ConceptLookupModule } from '../concept-lookup/concept-lookup.module';
import { PapersModule } from '../papers/papers.module';
import { DiscussionComment } from './discussion-comment.entity';
import { DiscussionController } from './discussion.controller';
import { DiscussionMarker } from './discussion-marker.entity';
import { DiscussionService } from './discussion.service';
import { DiscussionVote } from './discussion-vote.entity';
import { Notification } from './notification.entity';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DiscussionMarker,
      DiscussionComment,
      DiscussionVote,
      Notification,
      User,
    ]),
    ConceptLookupModule,
    PapersModule,
  ],
  controllers: [DiscussionController, NotificationController],
  providers: [DiscussionService, NotificationService],
})
export class DiscussionModule {}
