import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '../auth/session';
import {
  AddToLibraryDto,
  LibraryQueryDto,
  UpdateLibraryEntryDto,
} from './paper-library.dto';
import { PaperLibraryService } from './paper-library.service';

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
  get(
    @CurrentUserId() userId: number,
    @Param('paperId', ParseIntPipe) paperId: number,
  ) {
    return this.library.get(userId, paperId);
  }

  @Patch(':paperId')
  update(
    @CurrentUserId() userId: number,
    @Param('paperId', ParseIntPipe) paperId: number,
    @Body(updateBody) dto: UpdateLibraryEntryDto,
  ) {
    return this.library.update(userId, paperId, dto);
  }

  @Delete(':paperId')
  @HttpCode(204)
  async remove(
    @CurrentUserId() userId: number,
    @Param('paperId', ParseIntPipe) paperId: number,
  ) {
    await this.library.remove(userId, paperId);
  }
}
