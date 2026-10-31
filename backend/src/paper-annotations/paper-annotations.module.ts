import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PapersModule } from '../papers/papers.module';
import { PaperAnnotation } from './paper-annotation.entity';
import { PaperAnnotationsController } from './paper-annotations.controller';
import { PaperAnnotationsService } from './paper-annotations.service';

@Module({
  imports: [PapersModule, TypeOrmModule.forFeature([PaperAnnotation])],
  controllers: [PaperAnnotationsController],
  providers: [PaperAnnotationsService],
})
export class PaperAnnotationsModule {}
