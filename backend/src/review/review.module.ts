import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlgorithmsConceptsModule } from '../algorithms-concepts/algorithms-concepts.module';
import { DatabaseConceptsModule } from '../database-concepts/database-concepts.module';
import { JavaConceptsModule } from '../java-concepts/java-concepts.module';
import { JavaMinuteModule } from '../java-minute/java-minute.module';
import { JvmConceptsModule } from '../jvm-concepts/jvm-concepts.module';
import { RubyConceptsModule } from '../ruby-concepts/ruby-concepts.module';
import { RubyOnRailsConceptsModule } from '../rubyonrails-concepts/rubyonrails-concepts.module';
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
    JvmConceptsModule,
    SpringConceptsModule,
    DatabaseConceptsModule,
    SystemDesignConceptsModule,
    JavaMinuteModule,
    TestingConceptsModule,
    AlgorithmsConceptsModule,
    RubyConceptsModule,
    RubyOnRailsConceptsModule,
  ],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
