import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from '../lesson/lesson.entity';
import { JavaConceptsModule } from '../java-concepts/java-concepts.module';
import { JavaMinuteModule } from '../java-minute/java-minute.module';
import { MeilisearchClient } from './meilisearch.client';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [TypeOrmModule.forFeature([Course, Lesson]), JavaConceptsModule, JavaMinuteModule],
  controllers: [SearchController],
  providers: [SearchService, MeilisearchClient],
})
export class SearchModule {}
