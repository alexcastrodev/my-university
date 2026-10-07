import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from '../lesson/lesson.entity';
import { AlgorithmsConceptsModule } from '../algorithms-concepts/algorithms-concepts.module';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { DatabaseConceptsModule } from '../database-concepts/database-concepts.module';
import { JavaConceptsModule } from '../java-concepts/java-concepts.module';
import { JavaMinuteModule } from '../java-minute/java-minute.module';
import { CSharpMinuteModule } from '../csharp-minute/csharp-minute.module';
import { JvmConceptsModule } from '../jvm-concepts/jvm-concepts.module';
import { QuarkusConceptsModule } from '../quarkus-concepts/quarkus-concepts.module';
import { KubernetesConceptsModule } from '../kubernetes-concepts/kubernetes-concepts.module';
import { RubyConceptsModule } from '../ruby-concepts/ruby-concepts.module';
import { RubyOnRailsConceptsModule } from '../rubyonrails-concepts/rubyonrails-concepts.module';
import { DotNetConceptsModule } from '../dotnet-concepts/dotnet-concepts.module';
import { CSharpConceptsModule } from '../csharp-concepts/csharp-concepts.module';
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
    JvmConceptsModule,
    JavaMinuteModule,
    CSharpMinuteModule,
    CurriculumModule,
    DatabaseConceptsModule,
    SpringConceptsModule,
    SystemDesignConceptsModule,
    TestingConceptsModule,
    AlgorithmsConceptsModule,
    RubyConceptsModule,
    RubyOnRailsConceptsModule,
    DotNetConceptsModule,
    CSharpConceptsModule,
    QuarkusConceptsModule,
    KubernetesConceptsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService, MeilisearchClient],
})
export class SearchModule {}
