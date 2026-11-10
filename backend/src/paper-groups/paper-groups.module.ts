import { Module } from '@nestjs/common';
import { PaperAuditModule } from '../paper-audit/paper-audit.module';
import { PapersModule } from '../papers/papers.module';
import { PaperGroupBoardService } from './paper-group-board.service';
import { PaperGroupsController } from './paper-groups.controller';
import { PaperGroupsService } from './paper-groups.service';

@Module({
  imports: [PapersModule, PaperAuditModule],
  controllers: [PaperGroupsController],
  providers: [PaperGroupsService, PaperGroupBoardService],
})
export class PaperGroupsModule {}
