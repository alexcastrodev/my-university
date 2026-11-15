import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { ConceptLookupModule } from '../concept-lookup/concept-lookup.module';
import { DiscussionModule } from '../discussion/discussion.module';
import { FakeKurzModel } from './kurz-fake-model';
import {
  GeminiKurzModel,
  KurzModel,
  UnconfiguredKurzModel,
} from './kurz-model';
import { KurzController } from './kurz.controller';
import { assertFakeModelAllowed, fakeModelRequested } from './kurz.config';
import { KurzReportsService } from './kurz-reports.service';
import { KurzService } from './kurz.service';

@Module({
  imports: [AuthModule, AiModule, ConceptLookupModule, DiscussionModule],
  controllers: [KurzController],
  providers: [
    {
      provide: KurzModel,
      useFactory: (): KurzModel => {
        assertFakeModelAllowed();
        if (fakeModelRequested()) return new FakeKurzModel();
        const key = process.env.GOOGLE_GEMINI_API_KEY;
        return key ? new GeminiKurzModel(key) : new UnconfiguredKurzModel();
      },
    },
    KurzService,
    KurzReportsService,
  ],
  exports: [KurzReportsService],
})
export class KurzModule {}
