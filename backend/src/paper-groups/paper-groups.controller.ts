import { Body, CallHandler, Controller, Delete, ExecutionContext, Get, HttpCode, Inject, Injectable, NestInterceptor, Param, Patch, Post, Put, Query, UseInterceptors, ValidationPipe } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '../auth/session';
import { normalizeLanguage } from '../shared/language';
import { CreateGroupDto, InviteDto, PostDto, RoleDto, UpdateGroupDto } from './paper-group.dto';
import { PaperGroupBoardService } from './paper-group-board.service';
import { PaperGroupsService } from './paper-groups.service';

// esbuild (vitest) emits no decorator metadata, so each pipe is told its DTO by hand. Unknown fields are a 400.
const pipe = (expectedType: new () => object) =>
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType });

/** What a reader may see here depends on who they are and on their role, so nothing is cached. */
@Injectable()
class NoStore implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<FastifyReply>().header('Cache-Control', 'no-store');
    return next.handle();
  }
}

/**
 * The reading groups of the signed-in reader (#190). Everything needs a session and answers `no-store`: what a
 * reader may see depends on who they are and on their role. A group the reader is not in is a 404.
 */
@Controller('paper-groups')
@UseInterceptors(NoStore)
export class PaperGroupsController {
  constructor(
    @Inject(PaperGroupsService) private readonly groups: PaperGroupsService,
    @Inject(PaperGroupBoardService) private readonly board: PaperGroupBoardService,
  ) {}

  @Get()
  list(@CurrentUserId() userId: number, @Query('paper') paper?: string) {
    return this.groups.list(userId, paper);
  }

  @Post()
  create(@CurrentUserId() userId: number, @Body(pipe(CreateGroupDto)) body: CreateGroupDto) {
    return this.groups.create(userId, body);
  }

  // The reader's own invitations. Declared before `:id` so the static path wins.
  @Get('invitations')
  mine(@CurrentUserId() userId: number) {
    return this.groups.mine(userId);
  }

  @Post('invitations/:invitationId/accept')
  accept(@CurrentUserId() userId: number, @Param('invitationId') invitationId: string) {
    return this.groups.accept(userId, invitationId);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  async decline(@CurrentUserId() userId: number, @Param('invitationId') invitationId: string) {
    await this.groups.decline(userId, invitationId);
  }

  @Get(':id')
  get(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.groups.get(userId, id);
  }

  @Patch(':id')
  update(@CurrentUserId() userId: number, @Param('id') id: string, @Body(pipe(UpdateGroupDto)) body: UpdateGroupDto) {
    return this.groups.update(userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUserId() userId: number, @Param('id') id: string) {
    await this.groups.remove(userId, id);
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@CurrentUserId() userId: number, @Param('id') id: string) {
    await this.groups.leave(userId, id);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  async removeMember(@CurrentUserId() userId: number, @Param('id') id: string, @Param('memberId') memberId: string) {
    await this.groups.removeMember(userId, id, memberId);
  }

  @Patch(':id/members/:memberId')
  setRole(@CurrentUserId() userId: number, @Param('id') id: string, @Param('memberId') memberId: string, @Body(pipe(RoleDto)) body: RoleDto) {
    return this.groups.setRole(userId, id, memberId, body.role);
  }

  @Get(':id/invitations')
  invitations(@CurrentUserId() userId: number, @Param('id') id: string) {
    return this.groups.invitationsOf(userId, id);
  }

  @Post(':id/invitations')
  invite(@CurrentUserId() userId: number, @Param('id') id: string, @Body(pipe(InviteDto)) body: InviteDto) {
    return this.groups.invite(userId, id, body.user);
  }

  @Delete(':id/invitations/:invitationId')
  @HttpCode(204)
  async revoke(@CurrentUserId() userId: number, @Param('id') id: string, @Param('invitationId') invitationId: string) {
    await this.groups.revokeInvitation(userId, id, invitationId);
  }

  @Get(':id/papers')
  papers(@CurrentUserId() userId: number, @Param('id') id: string, @Query('lang') lang?: string) {
    return this.board.papers(userId, id, normalizeLanguage(lang));
  }

  /** Adds a public paper to the group; 200 with it, also when it was already there. */
  @Put(':id/papers/:slug')
  addPaper(@CurrentUserId() userId: number, @Param('id') id: string, @Param('slug') slug: string, @Query('lang') lang?: string) {
    return this.board.addPaper(userId, id, slug, normalizeLanguage(lang));
  }

  @Delete(':id/papers/:slug')
  @HttpCode(204)
  async removePaper(@CurrentUserId() userId: number, @Param('id') id: string, @Param('slug') slug: string) {
    await this.board.removePaper(userId, id, slug);
  }

  @Get(':id/posts')
  posts(@CurrentUserId() userId: number, @Param('id') id: string, @Query('paper') paper?: string, @Query('before') before?: string) {
    return this.board.posts(userId, id, { paper, before });
  }

  @Post(':id/posts')
  post(@CurrentUserId() userId: number, @Param('id') id: string, @Body(pipe(PostDto)) body: PostDto) {
    return this.board.post(userId, id, body);
  }

  @Delete(':id/posts/:postId')
  @HttpCode(204)
  async removePost(@CurrentUserId() userId: number, @Param('id') id: string, @Param('postId') postId: string) {
    await this.board.removePost(userId, id, postId);
  }

  @Get(':id/annotations')
  annotations(@CurrentUserId() userId: number, @Param('id') id: string, @Query('paper') paper?: string) {
    return this.board.annotations(userId, id, paper);
  }

  @Delete(':id/annotations/:shareId')
  @HttpCode(204)
  async removeAnnotation(@CurrentUserId() userId: number, @Param('id') id: string, @Param('shareId') shareId: string) {
    await this.board.removeAnnotation(userId, id, shareId);
  }
}
