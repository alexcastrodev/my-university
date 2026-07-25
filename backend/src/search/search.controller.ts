import { Controller, Get, Query } from '@nestjs/common';
import { SearchResultType, SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private service: SearchService) {}

  @Get()
  search(@Query('q') q: string | undefined, @Query('type') type: SearchResultType | undefined) {
    return this.service.search(q ?? '', type);
  }
}
