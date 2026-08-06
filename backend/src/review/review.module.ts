import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseConceptsModule } from '../database-concepts/database-concepts.module';
import { JavaConceptsModule } from '../java-concepts/java-concepts.module';
import { JavaMinuteModule } from '../java-minute/java-minute.module';
import { SpringConceptsModule } from '../spring-concepts/spring-concepts.module';
import { SystemDesignConceptsModule } from '../system-design-concepts/system-design-concepts.module';
import { TestingConceptsModule } from '../testing-concepts/testing-concepts.module';
import { ReviewSchedule } from './review-schedule.entity';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReviewSchedule]),
    JavaConceptsModule,
    SpringConceptsModule,
    DatabaseConceptsModule,
    SystemDesignConceptsModule,
    JavaMinuteModule,
    TestingConceptsModule,
  ],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
