import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from '../src/auth/auth.module';
import { User } from '../src/auth/user.entity';
import { PaperAnnotation } from '../src/paper-annotations/paper-annotation.entity';
import { PaperAnnotationsModule } from '../src/paper-annotations/paper-annotations.module';
import { PaperAttachment } from '../src/paper-attachments/paper-attachment.entity';
import { PaperAttachmentVersion } from '../src/paper-attachments/paper-attachment-version.entity';
import { PaperAttachmentsModule } from '../src/paper-attachments/paper-attachments.module';
import { PaperAttachmentsService } from '../src/paper-attachments/paper-attachments.service';
import { StorageDeletion } from '../src/paper-attachments/storage-deletion.entity';
import { Paper } from '../src/papers/paper.entity';
import { PaperAuthor } from '../src/papers/paper-author.entity';
import { PaperKeyword } from '../src/papers/paper-keyword.entity';
import { PaperSource } from '../src/papers/paper-source.entity';
import { PapersModule } from '../src/papers/papers.module';
import { PaperLibraryEntry } from '../src/papers/paper-library.entity';
import { PrivatePapersModule } from '../src/private-papers/private-papers.module';
import { StorageService } from '../src/storage/storage.service';
import { FixturePaper, usePapers } from './papers-fixtures';

export interface AttachmentsApp {
  /** `http://127.0.0.1:port/api` of the real Nest app. */
  url: string;
  dataSource: DataSource;
  storage: StorageService;
  /** Runs the maintenance job (retire stale uploads, empty the deletion queue) once, right now. */
  maintain: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * The real PapersModule, AuthModule, PaperAttachmentsModule and PaperAnnotationsModule on a free port against DATABASE_URL and the
 * S3-compatible storage from the S3_* variables, with small upload limits so the limit tests stay light.
 */
export async function startAttachmentsApp(limits: {
  maxBytes: number;
  quotaBytes: number;
  /** Most private papers (#203) one reader may keep; the default of the service when left out. */
  privatePapers?: number;
}, papers?: FixturePaper[]): Promise<AttachmentsApp> {
  const dropFiles = usePapers(papers);
  const saved = {
    max: process.env.PAPER_PDF_MAX_BYTES,
    quota: process.env.PAPER_PDF_USER_QUOTA_BYTES,
    dev: process.env.ENABLE_DEV_AUTH,
    cap: process.env.PAPER_PRIVATE_MAX_PER_USER,
  };
  process.env.PAPER_PDF_MAX_BYTES = String(limits.maxBytes);
  process.env.PAPER_PDF_USER_QUOTA_BYTES = String(limits.quotaBytes);
  process.env.ENABLE_DEV_AUTH = '1';
  if (limits.privatePapers) {
    process.env.PAPER_PRIVATE_MAX_PER_USER = String(limits.privatePapers);
  }

  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url:
          process.env.DATABASE_URL ??
          'postgres://postgres@127.0.0.1:5432/ocp_java',
        entities: [
          User,
          Paper,
          PaperAuthor,
          PaperKeyword,
          PaperSource,
          PaperLibraryEntry,
          PaperAttachment,
          PaperAttachmentVersion,
          PaperAnnotation,
          StorageDeletion,
        ],
        synchronize: false,
      }),
      AuthModule,
      PapersModule,
      PaperAttachmentsModule,
      PaperAnnotationsModule,
      PrivatePapersModule,
    ],
  })
  class AttachmentsModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    AttachmentsModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.register(fastifyCookie, { secret: 'random-test' });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');

  return {
    url: `${await app.getUrl()}/api`,
    dataSource: app.get(DataSource),
    storage: app.get(StorageService, { strict: false }),
    maintain: () => app.get(PaperAttachmentsService).maintain(),
    close: async () => {
      await app.close();
      dropFiles();
      for (const [key, value] of Object.entries({
        PAPER_PDF_MAX_BYTES: saved.max,
        PAPER_PDF_USER_QUOTA_BYTES: saved.quota,
        ENABLE_DEV_AUTH: saved.dev,
        PAPER_PRIVATE_MAX_PER_USER: saved.cap,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
