import { Module } from '@nestjs/common';
import { AiAccessService } from './ai-access.service';
import { AiCreditsService } from './ai-credits.service';
import { AiUsageService } from './ai-usage.service';
import { PlatformBudgetService } from './platform-budget.service';

@Module({
  providers: [
    AiCreditsService,
    AiUsageService,
    PlatformBudgetService,
    AiAccessService,
  ],
  exports: [
    AiCreditsService,
    AiUsageService,
    PlatformBudgetService,
    AiAccessService,
  ],
})
export class AiModule {}
