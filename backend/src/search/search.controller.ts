import { Controller, Get, Query } from '@nestjs/common';
import { normalizeLanguage } from '../shared/language';
import {
  SearchResponse,
  SearchResultType,
  SearchService,
} from './search.service';

@Controller('search')
export class SearchController {
  constructor(private service: SearchService) {}

  @Get()
  search(
    @Query('q') q: string | undefined,
    @Query('type') type: SearchResultType | undefined,
    @Query('lang') lang: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
  ): Promise<SearchResponse> {
    return this.service.search(q ?? '', {
      type,
      lang: normalizeLanguage(lang),
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    });
  }
}
