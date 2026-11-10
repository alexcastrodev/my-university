import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { PaperIds } from '../papers/paper-public-id';
import { CreateAnnotationDto, ShareAnnotationDto, UpdateAnnotationDto } from './paper-annotation.dto';
import { PaperAnnotationSharesService } from './paper-annotation-shares.service';
import { PaperAnnotationsService } from './paper-annotations.service';

// esbuild (vitest) emits no decorator metadata, so each pipe is told its DTO by hand. Unknown fields are a 400.
const strict = (expectedType: new () => object) =>
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType });
const createBody = strict(CreateAnnotationDto);
const updateBody = strict(UpdateAnnotationDto);
const shareBody = strict(ShareAnnotationDto);

/**
 * The signed-in reader's notes and annotations on one paper of their library. The paper is named like
 * everywhere else (a slug, or the UUID of their own private paper); a paper that is not in their library is a 404.
 */
@Controller('paper-library/:paperId/annotations')
export class PaperAnnotationsController {
  constructor(
    @Inject(PaperAnnotationsService) private readonly annotations: PaperAnnotationsService,
    @Inject(PaperAnnotationSharesService) private readonly shares: PaperAnnotationSharesService,
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

  /** Publishes a copy of this annotation (#187), or replaces the copy and its audience. Nothing else is shared. */
  @Put(':id/share')
  async share(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Param('id') id: string,
    @Body(shareBody) body: ShareAnnotationDto,
  ) {
    return this.shares.share(userId, await this.ids.resolveFor(userId, paperId), id, body);
  }

  /** Takes the share back. 204 whether or not it was shared. */
  @Delete(':id/share')
  @HttpCode(204)
  async unshare(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Param('id') id: string,
  ) {
    await this.shares.unshare(userId, await this.ids.resolveFor(userId, paperId), id);
  }
}

/**
 * What readers shared on a public paper, as the viewer is allowed to see it: open to a signed-out visitor too
 * (that is what a public share is), and never cached, so taking a share back takes effect on the next request.
 */
@Controller('papers/:slug/shared-annotations')
export class SharedAnnotationsController {
  constructor(
    @Inject(PaperAnnotationSharesService) private readonly shares: PaperAnnotationSharesService,
    @Inject(PaperIds) private readonly ids: PaperIds,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@OptionalUserId() viewerId: number | null, @Param('slug') slug: string) {
    this.ids.resolve(slug);
    return this.shares.visibleOn(slug, viewerId);
  }
}
