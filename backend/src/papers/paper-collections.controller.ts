import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, ValidationPipe } from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { CollectionNameDto } from './paper-collections.dto';
import { PaperCollectionsService } from './paper-collections.service';
import { PaperIds } from './paper-public-id';

// esbuild (vitest) emits no decorator metadata, so the pipe is told its DTO by hand. Unknown fields are a 400.
const nameBody = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType: CollectionNameDto });

/**
 * The signed-in reader's collections (#188). Everything needs a session and is private: a collection of someone
 * else is a 404. Browsing the papers of one is the library list with `?collection=<id>`.
 */
@Controller('paper-library/collections')
export class PaperCollectionsController {
  constructor(
    @Inject(PaperCollectionsService) private readonly collections: PaperCollectionsService,
    @Inject(PaperIds) private readonly ids: PaperIds,
  ) {}

  @Get()
  list(@CurrentUserId() userId: number) {
    return this.collections.list(userId);
  }

  @Post()
  create(@CurrentUserId() userId: number, @Body(nameBody) body: CollectionNameDto) {
    return this.collections.create(userId, body.name);
  }

  @Patch(':id')
  rename(@CurrentUserId() userId: number, @Param('id') id: string, @Body(nameBody) body: CollectionNameDto) {
    return this.collections.rename(userId, id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUserId() userId: number, @Param('id') id: string) {
    await this.collections.remove(userId, id);
  }

  /** Puts a paper of the reader's library in the collection; 200 with the collection, also when it was already in. */
  @Put(':id/papers/:paperId')
  async add(@CurrentUserId() userId: number, @Param('id') id: string, @Param('paperId') paperId: string) {
    return this.collections.add(userId, id, await this.ids.resolveFor(userId, paperId));
  }

  @Delete(':id/papers/:paperId')
  @HttpCode(204)
  async take(@CurrentUserId() userId: number, @Param('id') id: string, @Param('paperId') paperId: string) {
    await this.collections.take(userId, id, await this.ids.resolveFor(userId, paperId));
  }
}
