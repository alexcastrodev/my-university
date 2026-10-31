import { Module } from '@nestjs/common';
import { PaperAuditController } from './paper-audit.controller';
import { PaperAuditService } from './paper-audit.service';

@Module({
  controllers: [PaperAuditController],
  providers: [PaperAuditService],
  exports: [PaperAuditService],
})
export class PaperAuditModule {}
