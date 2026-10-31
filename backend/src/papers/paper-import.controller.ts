import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '../auth/session';
import { ImportDoiDto } from './paper-import.dto';
import { PaperImportService } from './paper-import.service';
import { PaperInputDto } from './paper.dto';

// esbuild (vitest) does not emit decorator metadata, so each pipe is told its DTO by hand.
const doiBody = new ValidationPipe({ transform: true, expectedType: ImportDoiDto });
const paperBody = new ValidationPipe({ transform: true, expectedType: PaperInputDto });

/** How a signed-in reader adds a paper: by DOI (with a preview first) or by hand. */
@Controller('papers')
export class PaperImportController {
  constructor(
    @Inject(PaperImportService) private readonly imports: PaperImportService,
  ) {}

  /** Looks the DOI up and says what importing it would do, without changing anything. */
  @Post('import/preview')
  @HttpCode(200)
  preview(
    @CurrentUserId() userId: number,
    @Body(doiBody) body: ImportDoiDto,
  ) {
    return this.imports.preview(userId, body.doi);
  }

  /** 201 when the paper is new, 200 when the DOI was already in the catalog. */
  @Post('import')
  async import(
    @CurrentUserId() userId: number,
    @Body(doiBody) body: ImportDoiDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.imports.import(userId, body.doi);
    reply.status(result.created ? 201 : 200);
    return result;
  }

  /** A paper entered by hand; 409 with the existing id when the catalog already has it. */
  @Post()
  async create(
    @CurrentUserId() userId: number,
    @Body(paperBody) body: PaperInputDto,
  ) {
    return this.imports.createManual(userId, body);
  }
}
