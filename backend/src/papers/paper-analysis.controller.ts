import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { PaperAnalysisService } from './paper-analysis.service';
import { parseSections } from './paper-analysis.sections';

/**
 * A paper's Research Analysis. Reading the published one is public; everything else needs a session and a
 * role (see roles.ts), checked in the service so no route can forget it.
 */
@Controller('papers/:id/analysis')
export class PaperAnalysisController {
  constructor(
    @Inject(PaperAnalysisService)
    private readonly analysis: PaperAnalysisService,
  ) {}

  @Get()
  published(@Param('id', ParseIntPipe) id: number) {
    return this.analysis.getPublic(id);
  }

  @Get('history')
  history(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserId() userId: number,
  ) {
    return this.analysis.history(id, userId);
  }

  @Put('draft')
  saveDraft(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserId() userId: number,
    @Body() body: unknown,
  ) {
    if (
      typeof body !== 'object' ||
      body === null ||
      Object.keys(body).join() !== 'sections'
    ) {
      throw new BadRequestException('The body must be { "sections": { ... } }');
    }
    return this.analysis.saveDraft(
      id,
      userId,
      parseSections((body as { sections: unknown }).sections),
    );
  }

  @Post('publish')
  @HttpCode(200)
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserId() userId: number,
  ) {
    return this.analysis.publish(id, userId);
  }

  @Post('withdraw')
  @HttpCode(200)
  withdraw(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserId() userId: number,
  ) {
    return this.analysis.withdraw(id, userId);
  }
}
