import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity';
import { Paper } from '../src/papers/paper.entity';
import { PaperLibraryEntry } from '../src/papers/paper-library.entity';
import { PaperAuthor } from '../src/papers/paper-author.entity';
import { PaperKeyword } from '../src/papers/paper-keyword.entity';
import { PaperSource } from '../src/papers/paper-source.entity';
import { PapersModule } from '../src/papers/papers.module';
import { FixturePaper, usePapers } from './papers-fixtures';

export interface CatalogApp {
  url: string;
  dataSource: DataSource;
  close: () => Promise<void>;
}

/**
 * The real PapersModule (controller, services, validation) on a free port against DATABASE_URL, with
 * the same `api` prefix as production, reading the given papers as its files (#213). Only the pieces the
 * catalog needs are loaded: no sessions, no search.
 */
export async function startCatalogApp(papers?: FixturePaper[]): Promise<CatalogApp> {
  const dropFiles = usePapers(papers);
  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url:
          process.env.DATABASE_URL ??
          'postgres://postgres@127.0.0.1:5432/ocp_java',
        entities: [
          Paper,
          PaperAuthor,
          PaperKeyword,
          PaperSource,
          PaperLibraryEntry,
          User,
        ],
        synchronize: false,
      }),
      PapersModule,
    ],
  })
  class CatalogModule {}

  let app: NestFastifyApplication;
  try {
    app = await NestFactory.create<NestFastifyApplication>(
      CatalogModule,
      new FastifyAdapter(),
      // Not aborting the process: a mistake in the files is a rejection a spec can assert on.
      { logger: false, abortOnError: false },
    );
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    // A mistake in the files stops the boot; the folder and the variable must not outlive it.
    dropFiles();
    throw error;
  }
  return {
    url: `${await app.getUrl()}/api`,
    dataSource: app.get(DataSource),
    close: async () => {
      await app.close();
      dropFiles();
    },
  };
}
