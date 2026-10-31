import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Paper } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperKeyword } from './paper-keyword.entity';
import { PaperSource } from './paper-source.entity';
import { PapersService } from './papers.service';

// No controller yet: the public catalog (#179) and the metadata import (#181) are what expose it.
@Module({
  imports: [
    TypeOrmModule.forFeature([Paper, PaperAuthor, PaperKeyword, PaperSource]),
  ],
  providers: [PapersService],
  exports: [PapersService],
})
export class PapersModule {}
