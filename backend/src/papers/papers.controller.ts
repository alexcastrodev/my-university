import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DataSource } from 'typeorm';
import { assertDevAuth } from '../auth/dev-auth';
import { PaperInputDto } from './paper.dto';
import { Paper } from './paper.entity';
import { PaperListQueryDto } from './paper-query.dto';
import { isLegacyId, PaperIds } from './paper-public-id';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersService } from './papers.service';

// esbuild (vitest) does not emit decorator metadata, so each pipe is told its DTO by hand. Unlike the
// global pipe, the query one rejects unknown fields: a typo in a filter name is a 400, not an unfiltered list.
const listQuery = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  expectedType: PaperListQueryDto,
});
const seedBody = new ValidationPipe({
  transform: true,
  expectedType: PaperInputDto,
});

/** The public catalog: anyone can read it, nobody can write to it from here. */
@Controller('papers')
export class PapersController {
  constructor(
    @Inject(PapersService) private readonly papers: PapersService,
    @Inject(PapersCatalogService)
    private readonly catalog: PapersCatalogService,
    @Inject(DataSource) private readonly dataSource: DataSource,
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

  /**
   * A paper by its public id. A bare integer is the id the paper had before #202: links with it exist, so it
   * answers 301 to the public id instead of 404, and the integer is never echoed back.
   */
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (isLegacyId(id)) {
      const publicId = await this.papers.publicIdOfLegacy(Number(id));
      reply.status(301).header('Location', `/api/papers/${publicId}`);
      return;
    }
    return this.papers.getPublic(id);
  }

  /** Dev/test-only (404 unless ENABLE_DEV_AUTH=1): papers have no public way in until the import (#181). */
  @Post('_test')
  async seed(
    @Body(seedBody) dto: PaperInputDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    assertDevAuth();
    const result = await this.papers.upsert(dto, { source: 'test' });
    reply.status(result.created ? 201 : 200);
    // The integer key is shown here, and only here (dev routes do not exist in production): the old-link
    // redirect needs a browser test, and nothing public tells a caller what a paper's integer was.
    return { ...result, legacyId: await this.ids.resolve(result.paper.id) };
  }

  /** Dev/test-only: removes a seeded paper; its authors, keywords and sources go with it (ON DELETE CASCADE). */
  @Delete('_test/:id')
  @HttpCode(204)
  async unseed(@Param('id') id: string) {
    assertDevAuth();
    await this.dataSource.getRepository(Paper).delete(await this.ids.resolve(id));
  }
}
