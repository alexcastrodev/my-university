import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Paper } from './paper.entity';
import { PaperAnalysis, PaperAnalysisEvent } from './paper-analysis.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperAnalysisController } from './paper-analysis.controller';
import { PaperAnalysisService } from './paper-analysis.service';
import { PaperKeyword } from './paper-keyword.entity';
import { PaperSource } from './paper-source.entity';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

// Reads are public (the catalog, #179, and the published analysis, #180). Writes of the analysis need a staff
// role; the paper itself has no write route yet: the metadata import (#181) brings it.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Paper,
      PaperAuthor,
      PaperKeyword,
      PaperSource,
      PaperAnalysis,
      PaperAnalysisEvent,
      User,
    ]),
  ],
  controllers: [PapersController, PaperAnalysisController],
  providers: [PapersService, PapersCatalogService, PaperAnalysisService],
  exports: [PapersService, PapersCatalogService],
})
export class PapersModule {}
