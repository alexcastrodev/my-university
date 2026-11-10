import {
  Controller,
  Headers,
  Inject,
  Post,
  Query,
  Req,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUserId } from '../auth/session';
import { fail } from '../paper-attachments/paper-attachments.service';
import { PrivatePapersService } from './private-papers.service';

export class PrivatePaperQueryDto {
  @IsString()
  @MaxLength(1000)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  doi?: string;
}

// esbuild (vitest) emits no decorator metadata, so the pipe is told its DTO by hand. Unknown fields are a 400.
const query = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  expectedType: PrivatePaperQueryDto,
});

/** Papers a reader adds from a PDF, outside the catalog. Needs a session; nothing here is public. */
@Controller('paper-library/private')
export class PrivatePapersController {
  constructor(
    @Inject(PrivatePapersService)
    private readonly privatePapers: PrivatePapersService,
  ) {}

  /**
   * The PDF is the raw request body (`Content-Type: application/pdf`) with its name in `X-Filename`, like the
   * attachment upload; the title and the optional DOI are query parameters. 201 when the paper joined the
   * library, 200 when it was already there and only gained a PDF version.
   */
  @Post()
  async create(
    @CurrentUserId() userId: number,
    @Query(query) params: PrivatePaperQueryDto,
    @Headers('x-filename') filename: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body)) {
      throw fail(
        415,
        'unsupported_media_type',
        'Send the PDF as the request body with Content-Type application/pdf.',
      );
    }
    const result = await this.privatePapers.create(userId, {
      title: params.title,
      doi: params.doi,
      filename: filename ?? '',
      bytes: body,
    });
    reply.status(result.created ? 201 : 200);
    return result;
  }
}
