import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Paper } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperKeyword } from './paper-keyword.entity';
import { PaperLibraryController } from './paper-library.controller';
import { PaperLibraryEntry } from './paper-library.entity';
import { PaperLibraryService } from './paper-library.service';
import { PaperSource } from './paper-source.entity';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

// Reads are public (the catalog, #179). Writes have no route yet: the metadata import (#181) brings it.
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
  controllers: [PapersController, PaperLibraryController],
  providers: [PapersService, PapersCatalogService, PaperLibraryService],
  exports: [PapersService, PapersCatalogService],
})
export class PapersModule {}
