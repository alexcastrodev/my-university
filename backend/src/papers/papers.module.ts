import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Paper } from './paper.entity';
import { PaperAnalysis, PaperAnalysisEvent } from './paper-analysis.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperAnalysisController } from './paper-analysis.controller';
import { PaperAnalysisService } from './paper-analysis.service';
import { PaperKeyword } from './paper-keyword.entity';
import { PaperLibraryController } from './paper-library.controller';
import { PaperLibraryEntry } from './paper-library.entity';
import { PaperLibraryService } from './paper-library.service';
import { PaperSource } from './paper-source.entity';
import { CrossrefClient } from './crossref.client';
import { PaperImportController } from './paper-import.controller';
import { PaperImportService } from './paper-import.service';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

// Reads are public (the catalog, #179, and the published analysis, #180). Writes of the analysis need a staff
// role. Adding a paper needs a session (import by DOI or by hand, #181); changing one that exists has no route yet.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Paper,
      PaperAuthor,
      PaperKeyword,
      PaperLibraryEntry,
      PaperSource,
      PaperAnalysis,
      PaperAnalysisEvent,
      User,
    ]),
  ],
  controllers: [PapersController, PaperAnalysisController, PaperImportController, PaperLibraryController],
  providers: [
    PapersService,
    PapersCatalogService,
    PaperAnalysisService,
    PaperImportService,
    CrossrefClient,
    PaperLibraryService,
  ],
  exports: [PapersService, PapersCatalogService],
})
export class PapersModule {}
