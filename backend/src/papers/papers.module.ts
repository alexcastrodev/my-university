import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Paper } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperKeyword } from './paper-keyword.entity';
import { PaperSource } from './paper-source.entity';
import { CrossrefClient } from './crossref.client';
import { PaperImportController } from './paper-import.controller';
import { PaperImportService } from './paper-import.service';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

// Reads are public (the catalog, #179). Adding a paper needs a session (import by DOI or by hand, #181);
// changing one that exists has no route yet.
@Module({
  imports: [
    TypeOrmModule.forFeature([Paper, PaperAuthor, PaperKeyword, PaperSource]),
  ],
  controllers: [PapersController, PaperImportController],
  providers: [
    PapersService,
    PapersCatalogService,
    PaperImportService,
    CrossrefClient,
  ],
  exports: [PapersService, PapersCatalogService],
})
export class PapersModule {}
