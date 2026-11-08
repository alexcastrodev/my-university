import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { normalizeLanguage } from '../shared/language';
import { BookmarksService, ConceptTarget } from './bookmarks.service';

const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;

function targetOf(body: Record<string, unknown> | undefined): ConceptTarget {
  const { module, slug, discipline } = body ?? {};
  if (!isName(module) || !isName(slug) || (discipline !== undefined && !isName(discipline))) {
    throw new BadRequestException('module and slug are required');
  }
  return discipline === undefined ? { module, slug } : { module, slug, discipline };
}

@Controller('bookmarks')
export class BookmarksController {
  constructor(private readonly service: BookmarksService) {}

  @Get()
  list(@CurrentUserId() userId: number, @Query('lang') lang?: string) {
    return this.service.list(userId, normalizeLanguage(lang));
  }

  @Put()
  set(
    @CurrentUserId() userId: number,
    @Body() body: Record<string, unknown> | undefined,
    @Query('lang') lang?: string,
  ) {
    return this.service.set(userId, targetOf(body), body?.tab, normalizeLanguage(lang));
  }

  @Put('lab-done')
  setLabDone(
    @CurrentUserId() userId: number,
    @Body() body: Record<string, unknown> | undefined,
    @Query('lang') lang?: string,
  ) {
    return this.service.setLabDone(userId, targetOf(body), body?.done, normalizeLanguage(lang));
  }

  @Delete(':id')
  remove(@CurrentUserId() userId: number, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.service.remove(userId, id, normalizeLanguage(lang));
  }
}
