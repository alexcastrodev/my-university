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
import { PaperInputDto } from './paper.dto';
import { PaperImportService } from './paper-import.service';

// esbuild (vitest) does not emit decorator metadata, so each pipe is told its DTO by hand.
const doiBody = new ValidationPipe({ transform: true, expectedType: ImportDoiDto });
const paperBody = new ValidationPipe({ transform: true, expectedType: PaperInputDto });

/**
 * How a signed-in reader adds a paper to their own library: by DOI (with a preview first) or by hand (#212).
 * Nothing here touches the public catalog. The PDF drop is `POST /paper-library/private`.
 */
@Controller('paper-library')
export class PaperImportController {
  constructor(
    @Inject(PaperImportService) private readonly imports: PaperImportService,
  ) {}

  /** Looks the DOI up and says what adding it would do, without changing anything. */
  @Post('import/preview')
  @HttpCode(200)
  preview(
    @CurrentUserId() userId: number,
    @Body(doiBody) body: ImportDoiDto,
  ) {
    return this.imports.preview(userId, body.doi);
  }

  /** 201 when the paper joined the library, 200 when it was already there. */
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

  /** A paper entered by hand; 409 with the reader's own paper when they already have it. */
  @Post('manual')
  async create(
    @CurrentUserId() userId: number,
    @Body(paperBody) body: PaperInputDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.imports.createManual(userId, body);
    reply.status(result.created ? 201 : 200);
    return result;
  }
}
