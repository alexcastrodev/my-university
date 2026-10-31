import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Paper } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperKeyword } from './paper-keyword.entity';
import { PaperLibraryController } from './paper-library.controller';
import { PaperLibraryEntry } from './paper-library.entity';
import { PaperLibraryService } from './paper-library.service';
import { PaperSource } from './paper-source.entity';
import { CrossrefClient } from './crossref.client';
import { PaperImportController } from './paper-import.controller';
import { PaperImportService } from './paper-import.service';
import { PaperIds } from './paper-public-id';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

// The public papers are authored files read through PapersCatalogService (#213): no route writes to them.
// Adding a paper needs a session and puts it in the reader's own library, never in the public list (#212).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Paper,
      PaperAuthor,
      PaperKeyword,
      PaperLibraryEntry,
      PaperSource,
    ]),
  ],
  controllers: [PapersController, PaperImportController, PaperLibraryController],
  providers: [
    PapersService,
    PapersCatalogService,
    PaperImportService,
    CrossrefClient,
    PaperLibraryService,
    PaperIds,
  ],
  exports: [PapersService, PapersCatalogService, PaperIds, PaperLibraryService],
})
export class PapersModule {}
