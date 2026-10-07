import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import {
  AcceptDto,
  CommentBodyDto,
  CreateThreadDto,
  ReplyDto,
  TopicDto,
} from './discussion.dto';
import { DiscussionService } from './discussion.service';

/**
 * Lives under /api/discussions on purpose: nginx caches the concept routes for an hour, and
 * discussions change by the minute. Responses are also marked no-store because they carry
 * per-viewer flags (`votedByMe`, `mine`). Unlike the global pipe, this one rejects unknown fields.
 */
@Controller('discussions')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class DiscussionController {
  constructor(private service: DiscussionService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  summary(@Query() topic: TopicDto) {
    return this.service.summary(topic);
  }

  @Get('markers/:id')
  @Header('Cache-Control', 'no-store')
  getMarker(
    @Param('id', ParseIntPipe) id: number,
    @OptionalUserId() userId: number | null,
  ) {
    return this.service.getMarker(id, userId);
  }

  @Post('threads')
  createThread(@CurrentUserId() userId: number, @Body() dto: CreateThreadDto) {
    return this.service.createThread(userId, dto);
  }

  @Post('markers/:id/comments')
  reply(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) markerId: number,
    @Body() dto: ReplyDto,
  ) {
    return this.service.reply(userId, markerId, dto.parentId, dto.body);
  }

  @Put('comments/:id')
  @HttpCode(204)
  edit(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CommentBodyDto,
  ) {
    return this.service.edit(userId, id, dto.body);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  remove(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(userId, id);
  }

  @Put('comments/:id/vote')
  @HttpCode(204)
  vote(@CurrentUserId() userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.vote(userId, id);
  }

  @Delete('comments/:id/vote')
  @HttpCode(204)
  unvote(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.unvote(userId, id);
  }

  @Put('comments/:id/accept')
  @HttpCode(204)
  accept(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptDto,
  ) {
    return this.service.accept(userId, id, dto.replyId);
  }

  @Delete('comments/:id/accept')
  @HttpCode(204)
  unaccept(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.unaccept(userId, id);
  }
}
