import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { FastifyInstance } from 'fastify';
import { StorageModule } from '../storage/storage.module';
import { PaperAttachment } from './paper-attachment.entity';
import { PaperAttachmentVersion } from './paper-attachment-version.entity';
import { PaperAttachmentsController } from './paper-attachments.controller';
import { PaperAttachmentsService } from './paper-attachments.service';
import { StorageDeletion } from './storage-deletion.entity';

// The first consumer of StorageModule: with this module loaded the S3 settings are checked at boot.
@Module({
  imports: [
    StorageModule,
    TypeOrmModule.forFeature([
      PaperAttachment,
      PaperAttachmentVersion,
      StorageDeletion,
    ]),
  ],
  controllers: [PaperAttachmentsController],
  providers: [PaperAttachmentsService],
  exports: [PaperAttachmentsService],
})
export class PaperAttachmentsModule implements OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
    @Inject(PaperAttachmentsService)
    private readonly attachments: PaperAttachmentsService,
  ) {}

  /**
   * A PDF arrives as the raw body. Fastify reads it into a Buffer and answers 413 itself, before the
   * handler runs, when it is over the limit (it checks Content-Length first, so most oversized uploads
   * are refused without being read).
   */
  onModuleInit() {
    const fastify = this.adapter.httpAdapter.getInstance() as FastifyInstance;
    for (const type of ['application/pdf', 'application/octet-stream']) {
      if (fastify.hasContentTypeParser(type)) continue;
      fastify.addContentTypeParser(
        type,
        { parseAs: 'buffer', bodyLimit: this.attachments.maxBytes },
        (_req, body, done) => done(null, body),
      );
    }
  }
}
