import { createServer, IncomingMessage, Server } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { Module } from '@nestjs/common';
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
import { Paper } from '../src/papers/paper.entity';
import { PaperAuthor } from '../src/papers/paper-author.entity';
import { PaperKeyword } from '../src/papers/paper-keyword.entity';
import { PaperSource } from '../src/papers/paper-source.entity';
import { PapersModule } from '../src/papers/papers.module';

/** What the stub Crossref answers for one DOI. */
export interface StubReply {
  status?: number;
  /** A JSON object (sent as `{ message: ... }`-wrapped by the test) or a raw string. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Close the connection without answering. */
  drop?: boolean;
}

export interface ImportApp {
  /** `http://127.0.0.1:port/api` of the real Nest app. */
  url: string;
  dataSource: DataSource;
  /** Replies by lower-case DOI; an unknown DOI is a 404, like Crossref's. */
  crossref: Map<string, StubReply>;
  /** Every request the stub received, in order. */
  requests: { doi: string; headers: IncomingMessage['headers']; search: string }[];
  close: () => Promise<void>;
}

/**
 * The real PapersModule and AuthModule (controllers, services, validation, signed session cookie) on a free
 * port against DATABASE_URL, talking to a stub Crossref on another free port through CROSSREF_BASE_URL.
 * Nothing in a test reaches the real Crossref.
 */
export async function startImportApp(): Promise<ImportApp> {
  const crossref = new Map<string, StubReply>();
  const requests: ImportApp['requests'] = [];
  const stub: Server = createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://stub');
    const doi = decodeURIComponent(parsed.pathname.replace(/^\/works\//, '')).toLowerCase();
    requests.push({ doi, headers: req.headers, search: parsed.search });
    const reply = crossref.get(doi);
    if (reply?.drop) {
      req.socket.destroy();
      return;
    }
    const status = reply?.status ?? 404;
    res.writeHead(status, { 'Content-Type': 'application/json', ...reply?.headers });
    const body = reply?.body ?? 'Resource not found.';
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const address = stub.address();
  if (!address || typeof address === 'string') throw new Error('stub has no port');

  const saved = {
    base: process.env.CROSSREF_BASE_URL,
    mailto: process.env.CROSSREF_MAILTO,
    dev: process.env.ENABLE_DEV_AUTH,
  };
  process.env.CROSSREF_BASE_URL = `http://127.0.0.1:${address.port}`;
  delete process.env.CROSSREF_MAILTO;
  process.env.ENABLE_DEV_AUTH = '1';

  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url:
          process.env.DATABASE_URL ??
          'postgres://postgres@127.0.0.1:5432/ocp_java',
        entities: [User, Paper, PaperAuthor, PaperKeyword, PaperSource],
        synchronize: false,
      }),
      AuthModule,
      PapersModule,
    ],
  })
  class ImportModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    ImportModule,
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
    crossref,
    requests,
    close: async () => {
      await app.close();
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      for (const [key, value] of Object.entries({
        CROSSREF_BASE_URL: saved.base,
        CROSSREF_MAILTO: saved.mailto,
        ENABLE_DEV_AUTH: saved.dev,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
