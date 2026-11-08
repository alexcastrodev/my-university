import { Module } from '@nestjs/common';
import { ConceptLookupModule } from '../concept-lookup/concept-lookup.module';
import { XpModule } from '../xp/xp.module';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';

@Module({
  imports: [ConceptLookupModule, XpModule],
  controllers: [BookmarksController],
  providers: [BookmarksService],
})
export class BookmarksModule {}
