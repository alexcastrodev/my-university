import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '../auth/session';
import { normalizeLanguage } from '../shared/language';
import {
  AddToLibraryDto,
  LibraryQueryDto,
  UpdateLibraryEntryDto,
} from './paper-library.dto';
import { PaperIds } from './paper-public-id';
import { PaperLibraryService } from './paper-library.service';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersService } from './papers.service';

// esbuild (vitest) emits no decorator metadata, so each pipe is told its DTO by hand. Unknown fields
// are rejected: a typo in a field or filter name is a 400, not a silently ignored change.
const strict = (expectedType: new () => object) =>
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    expectedType,
  });
const listQuery = strict(LibraryQueryDto);
const addBody = strict(AddToLibraryDto);
const updateBody = strict(UpdateLibraryEntryDto);

/** The signed-in reader's own papers. Nothing here is public: every route needs a session. */
@Controller('paper-library')
export class PaperLibraryController {
  constructor(
    @Inject(PaperLibraryService) private readonly library: PaperLibraryService,
    @Inject(PaperIds) private readonly ids: PaperIds,
    @Inject(PapersService) private readonly papers: PapersService,
    @Inject(PapersCatalogService) private readonly catalog: PapersCatalogService,
  ) {}

  @Get()
  list(
    @CurrentUserId() userId: number,
    @Query(listQuery) query: LibraryQueryDto,
  ) {
    return this.library.list(userId, query);
  }

  /** Counts per status and per tag, for the library's filters. */
  @Get('facets')
  facets(@CurrentUserId() userId: number) {
    return this.library.facets(userId);
  }

  /** 201 when the paper was added, 200 when it was already in the library (nothing changes). */
  @Post()
  async add(
    @CurrentUserId() userId: number,
    @Body(addBody) dto: AddToLibraryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { entry, created } = await this.library.add(userId, dto);
    reply.status(created ? 201 : 200);
    return entry;
  }

  @Get(':paperId')
  async get(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
  ) {
    return this.library.get(userId, await this.ids.resolveFor(userId, paperId));
  }

  /**
   * The paper itself, read through the library instead of the public route: a private paper has no public
   * address. It needs the entry, so a paper that is not in the reader's library is a 404 here.
   */
  @Get(':paperId/paper')
  async paper(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Query('lang') lang?: string,
  ) {
    const ref = await this.ids.resolveFor(userId, paperId);
    await this.library.get(userId, ref);
    return ref.kind === 'public'
      ? this.catalog.detail(ref.slug, normalizeLanguage(lang))
      : this.papers.getOwn(userId, ref.id);
  }

  @Patch(':paperId')
  async update(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Body(updateBody) dto: UpdateLibraryEntryDto,
  ) {
    return this.library.update(
      userId,
      await this.ids.resolveFor(userId, paperId),
      dto,
    );
  }

  @Delete(':paperId')
  @HttpCode(204)
  async remove(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
  ) {
    await this.library.remove(
      userId,
      await this.ids.resolveFor(userId, paperId),
    );
  }
}
