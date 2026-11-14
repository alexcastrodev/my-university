import { Module, ValidationPipe, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { expect } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { User } from '../src/auth/user.entity';

export interface AuthApp {
  /** `http://127.0.0.1:port/api` of the real Nest app. */
  url: string;
  dataSource: DataSource;
  /** A random tag in every name this run makes, so `cleanup` finds exactly its own rows. */
  run: string;
  /** Logs in through the test route; `role` is one more role by name, on top of the default student. */
  signIn: (role?: string) => Promise<{ cookie: string; id: number }>;
  /** A fetch with the cookie and, when `body` is given, a JSON body. */
  call: (
    method: string,
    path: string,
    cookie?: string,
    body?: unknown,
  ) => Promise<Response>;
  /** Makes a role holding `permissions`, named after this run, and gives it to the user. */
  give: (userId: number, permissions: string[]) => Promise<number>;
  close: () => Promise<void>;
}

/**
 * The real AuthModule plus the modules under test on a free port against DATABASE_URL, with the test login
 * on. The database must be migrated. `close` deletes the users, roles and audit rows this run made.
 */
export async function startAuthApp(
  modules: Type[],
  entities: Type[] = [],
): Promise<AuthApp> {
  const saved = process.env.ENABLE_DEV_AUTH;
  process.env.ENABLE_DEV_AUTH = '1';
  const run = Math.random().toString(36).slice(2, 8);
  let n = 0;
  let roles = 0;

  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url:
          process.env.DATABASE_URL ??
          'postgres://postgres@127.0.0.1:5432/ocp_java',
        entities: [User, ...entities],
        synchronize: false,
      }),
      AuthModule,
      ...modules,
    ],
  })
  class TestModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    TestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.register(fastifyCookie, { secret: 'random-test' });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/api`;
  const dataSource = app.get(DataSource);

  const call: AuthApp['call'] = (method, path, cookie, body) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return {
    url,
    dataSource,
    run,
    call,
    async signIn(role) {
      const res = await call('POST', '/auth/_test/login', undefined, {
        displayName: `t${n++} ${run}`,
        ...(role ? { role } : {}),
      });
      expect(res.status).toBe(201);
      return {
        cookie: (res.headers.getSetCookie()[0] ?? '').split(';')[0],
        id: ((await res.json()) as { id: number }).id,
      };
    },
    async give(userId, permissions) {
      const rows: { id: number }[] = await dataSource.query(
        `INSERT INTO role (name) VALUES ($1) RETURNING id`,
        [`r${roles++} ${run}`],
      );
      await dataSource.query(
        `INSERT INTO role_permission ("roleId", permission) SELECT $1, unnest($2::text[])`,
        [rows[0].id, permissions],
      );
      await dataSource.query(
        `INSERT INTO user_role ("userId", "roleId") VALUES ($1, $2)`,
        [userId, rows[0].id],
      );
      return rows[0].id;
    },
    async close() {
      const mine = `% ${run}`;
      await dataSource.query(
        `DELETE FROM admin_audit_event WHERE "actorUserId" IN (SELECT id FROM "user" WHERE "displayName" LIKE $1)
            OR "targetUserId" IN (SELECT id FROM "user" WHERE "displayName" LIKE $1)`,
        [mine],
      );
      await dataSource.query(`DELETE FROM role WHERE name LIKE $1`, [mine]);
      await dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [
        mine,
      ]);
      await app.close();
      if (saved === undefined) delete process.env.ENABLE_DEV_AUTH;
      else process.env.ENABLE_DEV_AUTH = saved;
    },
  };
}
