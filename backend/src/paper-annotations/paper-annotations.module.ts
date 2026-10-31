import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PapersModule } from '../papers/papers.module';
import { PaperAnnotation } from './paper-annotation.entity';
import { PaperAnnotationShare, PaperAnnotationShareRecipient } from './paper-annotation-share.entity';
import { PaperAnnotationsController, SharedAnnotationsController } from './paper-annotations.controller';
import { PaperAnnotationSharesService } from './paper-annotation-shares.service';
import { PaperAnnotationsService } from './paper-annotations.service';

@Module({
  imports: [PapersModule, TypeOrmModule.forFeature([PaperAnnotation, PaperAnnotationShare, PaperAnnotationShareRecipient])],
  controllers: [PaperAnnotationsController, SharedAnnotationsController],
  providers: [PaperAnnotationsService, PaperAnnotationSharesService],
})
export class PaperAnnotationsModule {}
