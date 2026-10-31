import { Controller, Get, Inject, Param, Query, ValidationPipe } from '@nestjs/common';
import { normalizeLanguage } from '../shared/language';
import { PaperListQueryDto } from './paper-query.dto';
import { PaperIds } from './paper-public-id';
import { PapersCatalogService } from './papers-catalog.service';

// esbuild (vitest) does not emit decorator metadata, so each pipe is told its DTO by hand. Unlike the
// global pipe, the query one rejects unknown fields: a typo in a filter name is a 400, not an unfiltered list.
const listQuery = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  expectedType: PaperListQueryDto,
});

/**
 * The public papers: anyone can read them, nobody can write to them from here. They are authored files (see
 * papers-catalog.service.ts), changed like a concept is, in a reviewed commit.
 */
@Controller('papers')
export class PapersController {
  constructor(
    @Inject(PapersCatalogService)
    private readonly catalog: PapersCatalogService,
    @Inject(PaperIds) private readonly ids: PaperIds,
  ) {}

  @Get()
  list(@Query(listQuery) query: PaperListQueryDto) {
    return this.catalog.list(query);
  }

  /** The research areas and publication types present in the catalog, for the filter selects. */
  @Get('facets')
  facets() {
    return this.catalog.facets();
  }

  /** A paper by its slug, with its analysis. A private paper, or an id that is no slug, is a 404. */
  @Get(':slug')
  get(@Param('slug') slug: string, @Query('lang') lang?: string) {
    this.ids.resolve(slug);
    return this.catalog.detail(slug, normalizeLanguage(lang));
  }
}
