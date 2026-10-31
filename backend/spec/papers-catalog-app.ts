import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Paper } from '../src/papers/paper.entity';
import { PaperAuthor } from '../src/papers/paper-author.entity';
import { PaperKeyword } from '../src/papers/paper-keyword.entity';
import { PaperSource } from '../src/papers/paper-source.entity';
import { PapersModule } from '../src/papers/papers.module';

export interface CatalogApp {
  url: string;
  close: () => Promise<void>;
}

/**
 * The real PapersModule (controller, services, validation) on a free port against DATABASE_URL, with
 * the same `api` prefix as production. Only the pieces the catalog needs are loaded: no sessions, no search.
 */
export async function startCatalogApp(): Promise<CatalogApp> {
  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url:
          process.env.DATABASE_URL ??
          'postgres://postgres@127.0.0.1:5432/ocp_java',
        entities: [Paper, PaperAuthor, PaperKeyword, PaperSource],
        synchronize: false,
      }),
      PapersModule,
    ],
  })
  class CatalogModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    CatalogModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { url: `${await app.getUrl()}/api`, close: () => app.close() };
}
