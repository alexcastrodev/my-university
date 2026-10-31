import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUserId } from '../auth/session';
import { PaperIds } from '../papers/paper-public-id';
import { PaperAttachmentsService, fail } from './paper-attachments.service';

/** `filename*` carries the real name (RFC 5987); the plain one is an ASCII fallback for old clients. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/**
 * The signed-in reader's own PDF for a paper. Everything needs a session, and a reader only ever sees
 * their own attachment: someone else's is a 404, the same as no attachment at all.
 *
 * The file goes through the API both ways (the browser never talks to storage), so the app, not a URL,
 * decides who may read it on every request.
 */
@Controller('papers/:paperId/attachment')
export class PaperAttachmentsController {
  constructor(
    @Inject(PaperAttachmentsService)
    private readonly attachments: PaperAttachmentsService,
    @Inject(PaperIds) private readonly ids: PaperIds,
  ) {}

  /**
   * Uploads the PDF as the raw request body (`Content-Type: application/pdf` or `application/octet-stream`),
   * with the name in `X-Filename`. 201 for the first file, 200 when it adds a version. The type the client
   * declares decides nothing: the content does, and a file that is not a clean PDF is a 422.
   */
  @Put()
  async upload(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
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
    const { attachment, created } = await this.attachments.upload(
      userId,
      await this.ids.resolve(paperId),
      body,
      filename ?? '',
    );
    reply.status(created ? 201 : 200);
    return attachment;
  }

  @Get()
  async get(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
  ) {
    return this.attachments.get(userId, await this.ids.resolve(paperId));
  }

  /** The approved file. Never cached and never rendered by the browser on this origin. */
  @Get('file')
  async file(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.attachments.open(
      userId,
      await this.ids.resolve(paperId),
    );
    await reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Length', file.size)
      .header('Content-Disposition', contentDisposition(file.filename))
      .header('ETag', `"${file.sha256}"`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .send(file.body);
  }

  @Delete()
  @HttpCode(204)
  async remove(
    @CurrentUserId() userId: number,
    @Param('paperId') paperId: string,
  ) {
    await this.attachments.remove(userId, await this.ids.resolve(paperId));
  }
}
