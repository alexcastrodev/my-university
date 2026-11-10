import { Controller, Get, Inject } from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { PaperAuditService } from './paper-audit.service';

/** What happened to the signed-in reader's own files and shares: their own rows, and nobody else's. */
@Controller('paper-library/activity')
export class PaperAuditController {
  constructor(@Inject(PaperAuditService) private readonly audit: PaperAuditService) {}

  @Get()
  recent(@CurrentUserId() userId: number) {
    return this.audit.recent(userId);
  }
}
