import { Controller, Get, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { makeAdmin } from '../src/auth/cli';
import { RequirePermission } from '../src/auth/permission.guard';
import { isPermission, PERMISSIONS } from '../src/auth/permissions';
import { CurrentUserId, parseSessionValue } from '../src/auth/session';
import { User } from '../src/auth/user.entity';

/**
 * Roles and permissions (#322): the format of the session cookie, what a new user holds, how permissions of
 * several roles add up, that a route asks for a permission and never for a role name, that a session can be
 * revoked, and the CLI that makes the first admin. The integration part runs a real Nest app against
 * DATABASE_URL (migrated up to AddRolesAndPermissions).
 */
describe('the session cookie value', () => {
  it('reads uid:epoch', () => {
    expect(parseSessionValue('5:2')).toEqual({ userId: 5, epoch: 2 });
    expect(parseSessionValue('12:0')).toEqual({ userId: 12, epoch: 0 });
  });

  it('reads a cookie from before epochs, just the id, as epoch 0', () => {
    expect(parseSessionValue('5')).toEqual({ userId: 5, epoch: 0 });
  });

  it('rejects anything else', () => {
    for (const value of [
      '',
      'abc',
      '0',
      '0:1',
      '-5',
      '5:',
      ':2',
      '5:-1',
      '5:2:3',
      '5.1.forged',
      '5 ',
      '1e3',
      '99999999999999999999',
    ]) {
      expect(parseSessionValue(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('the permission list', () => {
  it('knows its names, and only those', () => {
    for (const p of PERMISSIONS) expect(isPermission(p)).toBe(true);
    expect(isPermission('admin')).toBe(false);
    expect(isPermission(undefined)).toBe(false);
  });
});

/** Routes that stand for what a real one will do: ask for a permission, or just for a session. */
@Controller('guarded')
class GuardedController {
  @Get('ai')
  @RequirePermission('ai.use')
  ai() {
    return { ok: true };
  }

  @Get('credits')
  @RequirePermission('ai_credits.grant')
  credits() {
    return { ok: true };
  }

  @Get('session')
  session(@CurrentUserId() id: number) {
    return { id };
  }
}

const run = Math.random().toString(36).slice(2, 8);
let app: NestFastifyApplication;
let base: string;
let dataSource: DataSource;
let n = 0;
let savedDevAuth: string | undefined;

const call = (path: string, cookie?: string, method = 'GET') =>
  fetch(`${base}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });

/** Logs in through the test route; `role` is one more role by name, on top of the default student. */
async function signIn(
  role?: string,
): Promise<{ cookie: string; id: number; name: string }> {
  const name = `roles-${n++} ${run}`;
  const res = await fetch(`${base}/auth/_test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: name, ...(role ? { role } : {}) }),
  });
  expect(res.status).toBe(201);
  return {
    cookie: (res.headers.getSetCookie()[0] ?? '').split(';')[0],
    id: ((await res.json()) as { id: number }).id,
    name,
  };
}

const me = async (cookie: string) =>
  (await call('/auth/me', cookie)).json() as Promise<{
    permissions: string[];
  } | null>;

async function insertRole(name: string): Promise<number> {
  const rows: { id: number }[] = await dataSource.query(
    `INSERT INTO role (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return rows[0].id;
}

beforeAll(async () => {
  savedDevAuth = process.env.ENABLE_DEV_AUTH;
  process.env.ENABLE_DEV_AUTH = '1';

  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url:
          process.env.DATABASE_URL ??
          'postgres://postgres@127.0.0.1:5432/ocp_java',
        entities: [User],
        synchronize: false,
      }),
      AuthModule,
    ],
    controllers: [GuardedController],
  })
  class RolesTestModule {}

  app = await NestFactory.create<NestFastifyApplication>(
    RolesTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.register(fastifyCookie, { secret: 'random-test' });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api`;
  dataSource = app.get(DataSource);
});

afterAll(async () => {
  await dataSource.query(
    `DELETE FROM admin_audit_event WHERE "targetUserId" IN (SELECT id FROM "user" WHERE "displayName" LIKE $1)`,
    [`% ${run}`],
  );
  await dataSource.query(`DELETE FROM role WHERE name LIKE $1`, [`%${run}`]);
  await dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [
    `% ${run}`,
  ]);
  await app.close();
  if (savedDevAuth === undefined) delete process.env.ENABLE_DEV_AUTH;
  else process.env.ENABLE_DEV_AUTH = savedDevAuth;
});

describe('the seeded roles', () => {
  it('has admin and student, both system roles', async () => {
    const rows: { name: string; system: boolean }[] = await dataSource.query(
      `SELECT name, system FROM role WHERE name IN ('admin', 'student') ORDER BY name`,
    );
    expect(rows).toEqual([
      { name: 'admin', system: true },
      { name: 'student', system: true },
    ]);
  });

  it('gives the admin role every permission in the code, and a student only ai.use', async () => {
    const perms = async (role: string) => {
      const rows: { permission: string }[] = await dataSource.query(
        `SELECT rp.permission FROM role_permission rp JOIN role r ON r.id = rp."roleId" WHERE r.name = $1 ORDER BY 1`,
        [role],
      );
      return rows.map((r) => r.permission).sort();
    };
    expect(await perms('admin')).toEqual([...PERMISSIONS].sort());
    expect(await perms('student')).toEqual(['ai.use']);
  });
});

describe('a new user', () => {
  it('is a student: ai.use and nothing else', async () => {
    const { cookie } = await signIn();
    expect((await me(cookie))?.permissions).toEqual(['ai.use']);
  });

  it('is refused with 400, naming the problem, when the test login asks for a role that does not exist', async () => {
    const res = await fetch(`${base}/auth/_test/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: `roles-x ${run}`, role: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('a route that asks for a permission', () => {
  it('answers 401 without a session', async () => {
    expect((await call('/guarded/ai')).status).toBe(401);
    expect((await call('/guarded/credits')).status).toBe(401);
  });

  it('answers 403 to a user without it, and 200 to one with it', async () => {
    const student = await signIn();
    expect((await call('/guarded/ai', student.cookie)).status).toBe(200);
    expect((await call('/guarded/credits', student.cookie)).status).toBe(403);
    const admin = await signIn('admin');
    expect((await call('/guarded/credits', admin.cookie)).status).toBe(200);
  });

  it('is decided by what the user holds, not by a role name: a role of any name that holds it is enough', async () => {
    const { cookie, id } = await signIn();
    expect((await call('/guarded/credits', cookie)).status).toBe(403);
    const roleId = await insertRole(`treasurer ${run}`);
    await dataSource.query(
      `INSERT INTO role_permission ("roleId", permission) VALUES ($1, 'ai_credits.grant')`,
      [roleId],
    );
    await dataSource.query(
      `INSERT INTO user_role ("userId", "roleId") VALUES ($1, $2)`,
      [id, roleId],
    );
    expect((await call('/guarded/credits', cookie)).status).toBe(200);
  });

  it('adds up the permissions of every role the user has, and counts a permission held twice once', async () => {
    const { cookie, id } = await signIn();
    const roleId = await insertRole(`support ${run}`);
    await dataSource.query(
      `INSERT INTO role_permission ("roleId", permission) VALUES ($1, 'users.view'), ($1, 'ai.use')`,
      [roleId],
    );
    await dataSource.query(
      `INSERT INTO user_role ("userId", "roleId") VALUES ($1, $2)`,
      [id, roleId],
    );
    expect((await me(cookie))?.permissions.sort()).toEqual([
      'ai.use',
      'users.view',
    ]);
  });

  it('feels a role taken away at the next request, with no new login', async () => {
    const admin = await signIn('admin');
    expect((await call('/guarded/credits', admin.cookie)).status).toBe(200);
    await dataSource.query(
      `DELETE FROM user_role WHERE "userId" = $1 AND "roleId" = (SELECT id FROM role WHERE name = 'admin')`,
      [admin.id],
    );
    expect((await call('/guarded/credits', admin.cookie)).status).toBe(403);
  });

  it('ignores a permission name the code does not know', async () => {
    const { cookie, id } = await signIn();
    const roleId = await insertRole(`ghost ${run}`);
    await dataSource.query(
      `INSERT INTO role_permission ("roleId", permission) VALUES ($1, 'galaxy.rule')`,
      [roleId],
    );
    await dataSource.query(
      `INSERT INTO user_role ("userId", "roleId") VALUES ($1, $2)`,
      [id, roleId],
    );
    expect((await me(cookie))?.permissions).toEqual(['ai.use']);
  });
});

describe('a session that can be revoked', () => {
  it('stops working everywhere when the user signs out everywhere', async () => {
    const { cookie } = await signIn();
    expect((await call('/guarded/session', cookie)).status).toBe(200);
    const res = await call('/auth/logout-all', cookie, 'POST');
    expect(res.status).toBe(201);
    expect((await call('/guarded/session', cookie)).status).toBe(401);
    expect(await me(cookie)).toBeNull();
  });

  it('stops working when the epoch rises for any reason, as it does when an admin changes the roles of a user', async () => {
    const { cookie, id } = await signIn();
    await dataSource.query(
      `UPDATE "user" SET "sessionEpoch" = "sessionEpoch" + 1 WHERE id = $1`,
      [id],
    );
    expect((await call('/guarded/session', cookie)).status).toBe(401);
    expect((await call('/guarded/ai', cookie)).status).toBe(401);
  });

  it('does not touch the sessions of other users', async () => {
    const a = await signIn();
    const b = await signIn();
    await call('/auth/logout-all', a.cookie, 'POST');
    expect((await call('/guarded/session', b.cookie)).status).toBe(200);
  });

  it('stops working when the user is deleted', async () => {
    const { cookie, id } = await signIn();
    await dataSource.query(`DELETE FROM "user" WHERE id = $1`, [id]);
    expect((await call('/guarded/session', cookie)).status).toBe(401);
  });

  it('keeps a cookie from before epochs working (just the id counts as epoch 0), and refuses one for the wrong epoch', async () => {
    const { id } = await signIn();
    const sign = (value: string) =>
      `uid=${encodeURIComponent(app.getHttpAdapter().getInstance().signCookie(value))}`;
    expect((await call('/guarded/session', sign(String(id)))).status).toBe(200);
    expect((await call('/guarded/session', sign(`${id}:0`))).status).toBe(200);
    expect((await call('/guarded/session', sign(`${id}:1`))).status).toBe(401);
    await dataSource.query(
      `UPDATE "user" SET "sessionEpoch" = 1 WHERE id = $1`,
      [id],
    );
    expect((await call('/guarded/session', sign(String(id)))).status).toBe(401);
    expect((await call('/guarded/session', sign(`${id}:1`))).status).toBe(200);
  });

  it('does not leak the epoch in what /auth/me returns', async () => {
    const { cookie } = await signIn();
    expect(await me(cookie)).not.toHaveProperty('sessionEpoch');
  });
});

describe('the CLI that makes the first admin', () => {
  it('gives the admin role to the user with that GitHub login, once, and records it with no actor', async () => {
    const { id, name } = await signIn();
    expect(await makeAdmin(dataSource, name)).toBe(
      `user ${id} is now an admin`,
    );
    expect(await makeAdmin(dataSource, name)).toBe(
      `user ${id} is already an admin`,
    );
    const audit: {
      actorUserId: number | null;
      action: string;
      detail: unknown;
    }[] = await dataSource.query(
      `SELECT "actorUserId", action, detail FROM admin_audit_event WHERE "targetUserId" = $1`,
      [id],
    );
    expect(audit).toEqual([
      {
        actorUserId: null,
        action: 'user.role.add',
        detail: { role: 'admin', via: 'cli' },
      },
    ]);
  });

  it('makes a user whose permissions reach every guarded route', async () => {
    const { cookie, name } = await signIn();
    expect((await call('/guarded/credits', cookie)).status).toBe(403);
    await makeAdmin(dataSource, name);
    expect((await call('/guarded/credits', cookie)).status).toBe(200);
  });

  it('refuses a login nobody has, and one that more than one user has', async () => {
    await expect(makeAdmin(dataSource, `nobody ${run}`)).rejects.toThrow(
      /no user with the GitHub login/,
    );
    const { name } = await signIn();
    await dataSource.query(
      `INSERT INTO "user" ("githubId", "githubLogin", "displayName", "avatarUrl") VALUES ($1, $2, $2, '')`,
      [`test-dup-${run}`, name],
    );
    await expect(makeAdmin(dataSource, name)).rejects.toThrow(
      /a login can be renamed/,
    );
  });
});
