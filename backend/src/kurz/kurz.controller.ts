import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { RequirePermission } from '../auth/permission.guard';
import { TopicDto } from '../discussion/discussion.dto';
import { AcceptTermsDto, AskKurzDto, FeedbackDto, ReportDto } from './kurz.dto';
import { KurzService } from './kurz.service';

/**
 * The Kurz (#317). Its reads are never cached, and nothing that spends is a GET: the session cookie is `SameSite=Lax`, which
 * a browser sends on a navigation from another site, so a GET that spends would let any link burn a student's
 * credit. Which routes need which permission is in `spec/kurz-api.spec.ts`, which lists them all.
 *
 * A student can always read, erase and report their own data and accept the terms, with the Kurz off or with
 * `ai.use` taken away; asking and publishing need the switch and the permission.
 */
@Controller('kurz')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class KurzController {
  constructor(private readonly service: KurzService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@CurrentUserId() userId: number) {
    return this.service.status(userId);
  }

  @Post('terms')
  @HttpCode(204)
  async terms(@CurrentUserId() userId: number, @Body() dto: AcceptTermsDto) {
    await this.service.acceptTerms(userId, dto);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('ai.use')
  ask(@CurrentUserId() userId: number, @Body() dto: AskKurzDto) {
    return this.service.ask(userId, dto);
  }

  @Get('conversations')
  @Header('Cache-Control', 'no-store')
  conversations(@CurrentUserId() userId: number, @Query() topic: TopicDto) {
    return this.service.conversations(userId, topic);
  }

  @Delete('conversations')
  @HttpCode(200)
  async deleteAll(@CurrentUserId() userId: number) {
    return { deleted: await this.service.deleteConversations(userId) };
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteOne(
    @CurrentUserId() userId: number,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteConversations(userId, id);
  }

  @Put('messages/:id/feedback')
  @HttpCode(204)
  async feedback(
    @CurrentUserId() userId: number,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeedbackDto,
  ) {
    await this.service.feedback(userId, id, dto.helpful);
  }

  @Post('messages/:id/report')
  @HttpCode(204)
  async report(
    @CurrentUserId() userId: number,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDto,
  ) {
    await this.service.report(userId, id, dto.note);
  }

  @Post('messages/:id/share')
  @HttpCode(200)
  @RequirePermission('ai.use')
  share(
    @CurrentUserId() userId: number,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.share(userId, id);
  }
}
