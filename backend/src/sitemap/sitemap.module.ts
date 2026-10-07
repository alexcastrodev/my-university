import { Module } from '@nestjs/common';
import { AlgorithmsConceptsModule } from '../algorithms-concepts/algorithms-concepts.module';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { DatabaseConceptsModule } from '../database-concepts/database-concepts.module';
import { ExamModule } from '../exam/exam.module';
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
import { DotNetTestingConceptsModule } from '../dotnet-testing-concepts/dotnet-testing-concepts.module';
import { SpringConceptsModule } from '../spring-concepts/spring-concepts.module';
import { SystemDesignConceptsModule } from '../system-design-concepts/system-design-concepts.module';
import { TestingConceptsModule } from '../testing-concepts/testing-concepts.module';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';

@Module({
  imports: [
    JavaConceptsModule,
    JvmConceptsModule,
    DatabaseConceptsModule,
    SpringConceptsModule,
    SystemDesignConceptsModule,
    TestingConceptsModule,
    AlgorithmsConceptsModule,
    JavaMinuteModule,
    CSharpMinuteModule,
    ExamModule,
    RubyConceptsModule,
    RubyOnRailsConceptsModule,
    DotNetConceptsModule,
    CSharpConceptsModule,
    DotNetTestingConceptsModule,
    QuarkusConceptsModule,
    KubernetesConceptsModule,
    CurriculumModule,
  ],
  controllers: [SitemapController],
  providers: [SitemapService],
})
export class SitemapModule {}
