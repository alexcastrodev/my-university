import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { withBootLock } from './shared/boot-lock';

/** Signs the session cookie. A missing secret in production would silently fall back to a
 *  publicly known value (anyone could forge `uid=<id>` for any user), so it fails the boot instead. */
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return 'random-test';
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.register(fastifyCookie, {
    secret: sessionSecret(),
  });
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:4200', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api');

  // Migrations, then `app.init()` (which runs SeedService and the other bootstrap hooks), under
  // one cross-replica lock; see boot-lock.ts. `listen()` below skips init since it already ran.
  const dataSource = app.get(DataSource);
  await withBootLock(dataSource, async () => {
    await dataSource.runMigrations({ transaction: 'all' });
    await app.init();
  });

  await app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
}
bootstrap();
