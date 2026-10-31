import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { PaperAnalysisService } from './paper-analysis.service';
import { parseSections } from './paper-analysis.sections';
import { PaperIds } from './paper-public-id';

/**
 * A paper's Research Analysis. Reading the published one is public; everything else needs a session and a
 * role (see roles.ts), checked in the service so no route can forget it.
 */
@Controller('papers/:id/analysis')
export class PaperAnalysisController {
  constructor(
    @Inject(PaperAnalysisService)
    private readonly analysis: PaperAnalysisService,
    @Inject(PaperIds) private readonly ids: PaperIds,
  ) {}

  @Get()
  async published(@Param('id') id: string) {
    return this.analysis.getPublic(await this.ids.resolve(id));
  }

  @Get('history')
  async history(@Param('id') id: string, @CurrentUserId() userId: number) {
    return this.analysis.history(await this.ids.resolve(id), userId);
  }

  @Put('draft')
  async saveDraft(
    @Param('id') id: string,
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
      await this.ids.resolve(id),
      userId,
      parseSections((body as { sections: unknown }).sections),
    );
  }

  @Post('publish')
  @HttpCode(200)
  async publish(@Param('id') id: string, @CurrentUserId() userId: number) {
    return this.analysis.publish(await this.ids.resolve(id), userId);
  }

  @Post('withdraw')
  @HttpCode(200)
  async withdraw(@Param('id') id: string, @CurrentUserId() userId: number) {
    return this.analysis.withdraw(await this.ids.resolve(id), userId);
  }
}
