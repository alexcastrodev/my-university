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
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { PaperIds } from '../papers/paper-public-id';
import { CreateAnnotationDto, UpdateAnnotationDto } from './paper-annotation.dto';
import { PaperAnnotationsService } from './paper-annotations.service';

// esbuild (vitest) emits no decorator metadata, so each pipe is told its DTO by hand. Unknown fields are a 400.
const strict = (expectedType: new () => object) =>
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType });
const createBody = strict(CreateAnnotationDto);
const updateBody = strict(UpdateAnnotationDto);

/**
 * The signed-in reader's notes and annotations on one paper of their library. The paper is named like
 * everywhere else (a slug, or the UUID of their own private paper); a paper that is not in their library is a 404.
 */
@Controller('paper-library/:paperId/annotations')
export class PaperAnnotationsController {
  constructor(
    @Inject(PaperAnnotationsService) private readonly annotations: PaperAnnotationsService,
    @Inject(PaperIds) private readonly ids: PaperIds,
  ) {}

  @Get()
  async list(@CurrentUserId() userId: number, @Param('paperId') paperId: string) {
    return this.annotations.list(userId, await this.ids.resolveFor(userId, paperId));
  }

  @Post()
  async create(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Body(createBody) body: CreateAnnotationDto,
  ) {
    return this.annotations.create(userId, await this.ids.resolveFor(userId, paperId), body);
  }

  @Patch(':id')
  async update(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Param('id') id: string,
    @Body(updateBody) body: UpdateAnnotationDto,
  ) {
    return this.annotations.update(userId, await this.ids.resolveFor(userId, paperId), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Param('id') id: string,
  ) {
    await this.annotations.remove(userId, await this.ids.resolveFor(userId, paperId), id);
  }
}
