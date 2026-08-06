import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from '../lesson/lesson.entity';
import { DatabaseConceptsModule } from '../database-concepts/database-concepts.module';
import { JavaConceptsModule } from '../java-concepts/java-concepts.module';
import { JavaMinuteModule } from '../java-minute/java-minute.module';
import { SpringConceptsModule } from '../spring-concepts/spring-concepts.module';
import { SystemDesignConceptsModule } from '../system-design-concepts/system-design-concepts.module';
import { TestingConceptsModule } from '../testing-concepts/testing-concepts.module';
import { MeilisearchClient } from './meilisearch.client';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, Lesson]),
    JavaConceptsModule,
    JavaMinuteModule,
    DatabaseConceptsModule,
    SpringConceptsModule,
    SystemDesignConceptsModule,
    TestingConceptsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService, MeilisearchClient],
})
export class SearchModule {}
