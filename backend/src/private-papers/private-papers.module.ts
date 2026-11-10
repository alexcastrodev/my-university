import { Module } from '@nestjs/common';
import { PaperAttachmentsModule } from '../paper-attachments/paper-attachments.module';
import { PapersModule } from '../papers/papers.module';
import { PrivatePapersController } from './private-papers.controller';
import { PrivatePapersService } from './private-papers.service';

@Module({
  imports: [PapersModule, PaperAttachmentsModule],
  controllers: [PrivatePapersController],
  providers: [PrivatePapersService],
})
export class PrivatePapersModule {}
