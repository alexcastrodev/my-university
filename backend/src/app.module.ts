import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { User } from './auth/user.entity';
import { CourseNestModule } from './course/course.module';
import { Exam } from './exam/exam.entity';
import { ExamAttempt } from './exam/exam-attempt.entity';
import { ExamModule } from './exam/exam.module';
import { Question } from './exam/question.entity';
import { CourseModule as CourseModuleEntity } from './lesson/course-module.entity';
import { Lesson } from './lesson/lesson.entity';
import { Course } from './course/course.entity';
import { AlgorithmsConceptsModule } from './algorithms-concepts/algorithms-concepts.module';
import { CurriculumModule } from './curriculum/curriculum.module';
import { DailyModule } from './daily/daily.module';
import { FeedModule } from './feed/feed.module';
import { DailyWriteAnswer } from './daily/daily-write-answer.entity';
import { DatabaseConceptsModule } from './database-concepts/database-concepts.module';
import { JavaConceptsModule } from './java-concepts/java-concepts.module';
import { JavaMinuteModule } from './java-minute/java-minute.module';
import { CSharpMinuteModule } from './csharp-minute/csharp-minute.module';
import { JvmConceptsModule } from './jvm-concepts/jvm-concepts.module';
import { OgImageModule } from './og-image/og-image.module';
import { Progress } from './progress/progress.entity';
import { ProgressModule } from './progress/progress.module';
import { QuarkusConceptsModule } from './quarkus-concepts/quarkus-concepts.module';
import { KubernetesConceptsModule } from './kubernetes-concepts/kubernetes-concepts.module';
import { ReviewSchedule } from './review/review-schedule.entity';
import { ReviewModule } from './review/review.module';
import { RubyConceptsModule } from './ruby-concepts/ruby-concepts.module';
import { RubyOnRailsConceptsModule } from './rubyonrails-concepts/rubyonrails-concepts.module';
import { DotNetConceptsModule } from './dotnet-concepts/dotnet-concepts.module';
import { CSharpConceptsModule } from './csharp-concepts/csharp-concepts.module';
import { SearchModule } from './search/search.module';
import { SeedModule } from './seed/seed.module';
import { SitemapModule } from './sitemap/sitemap.module';
import { SpringConceptsModule } from './spring-concepts/spring-concepts.module';
import { SystemDesignConceptsModule } from './system-design-concepts/system-design-concepts.module';
import { TestingConceptsModule } from './testing-concepts/testing-concepts.module';
import { UserXpEntry } from './xp/user-xp.entity';
import { XpModule } from './xp/xp.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgres://postgres@127.0.0.1:5432/ocp_java',
      entities: [
        User,
        Course,
        CourseModuleEntity,
        Lesson,
        Progress,
        Exam,
        Question,
        ExamAttempt,
        UserXpEntry,
        ReviewSchedule,
        DailyWriteAnswer,
      ],
      migrations: [join(__dirname, 'migrations', '*.js')],
      // Run explicitly in main.ts under a cross-replica advisory lock instead.
      migrationsRun: false,
      synchronize: false,
    }),
    AuthModule,
    CourseNestModule,
    JavaMinuteModule,
    CSharpMinuteModule,
    JavaConceptsModule,
    JvmConceptsModule,
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
    CurriculumModule,
    ProgressModule,
    ExamModule,
    XpModule,
    ReviewModule,
    DailyModule,
    FeedModule,
    SeedModule,
    SearchModule,
    SitemapModule,
    OgImageModule,
  ],
  controllers: [AppController],
  providers: [
    // Reports unhandled errors (not HttpExceptions like 404/401) to Sentry. Must be registered
    // before any other exception filter.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    AppService,
  ],
})
export class AppModule {}
