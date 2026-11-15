import { RequestMethod } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminController } from '../src/admin/admin.controller';
import { AdminModule } from '../src/admin/admin.module';
import { PERMISSION_KEY } from '../src/auth/permission.guard';
import { holdsAll, PERMISSIONS } from '../src/auth/permissions';
import { AuthApp, startAuthApp } from './auth-app';

/**
 * The admin area (#322): that every route names the permission it needs, that nobody climbs (gives or
 * makes what they do not hold themselves), that every change leaves a row in the audit trail, that a user whose
 * roles change signs in again, and that the system is never left without an admin.
 */
let t: AuthApp;

beforeAll(async () => {
  t = await startAuthApp([AdminModule]);
});
afterAll(() => t.close());

const roleName = (label: string) => `${label} ${t.run}`;
const json = async <T>(res: Response) => (await res.json()) as T;

interface Role {
  id: number;
  name: string;
  system: boolean;
  permissions: string[];
  users: number;
}

describe('the rule of not climbing', () => {
  it('lets someone hand out only what they hold', () => {
    expect(holdsAll(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
    expect(holdsAll(['a'], ['a', 'b'])).toBe(false);
    expect(holdsAll([], [])).toBe(true);
  });
});

describe('every admin route names the permission it needs', () => {
  const routes = () => {
    const out: { method: string; path: string; permission?: string }[] = [];
    for (const name of Object.getOwnPropertyNames(AdminController.prototype)) {
      const handler = (
        AdminController.prototype as unknown as Record<string, object>
      )[name];
      const method = Reflect.getMetadata('method', handler) as
        | RequestMethod
        | undefined;
      if (method === undefined) continue;
      const path = Reflect.getMetadata('path', handler) as string;
      out.push({
        method: RequestMethod[method],
        path: `/admin/${path}`.replace(/\/$/, ''),
        permission: Reflect.getMetadata(PERMISSION_KEY, handler) as
          | string
          | undefined,
      });
    }
    return out;
  };

  it('finds the routes, and none is without a permission, and each is one the code knows', () => {
    const found = routes();
    expect(found.length).toBe(13);
    for (const r of found) {
      expect(r.permission, `${r.method} ${r.path}`).toBeTruthy();
      expect(PERMISSIONS as readonly string[]).toContain(r.permission);
    }
  });

  it('answers 401 without a session and 403 to a plain student, on every one', async () => {
    const student = await t.signIn();
    for (const r of routes()) {
      const path = r.path.replace(/:\w+/g, '1');
      const body = ['POST', 'PUT'].includes(r.method) ? {} : undefined;
      expect((await t.call(r.method, path)).status, `${r.method} ${path}`).toBe(
        401,
      );
      expect(
        (await t.call(r.method, path, student.cookie, body)).status,
        `${r.method} ${path}`,
      ).toBe(403);
    }
  });
});

describe('roles', () => {
  it('lists the system roles with what they hold, to someone who may enter the admin area', async () => {
    const admin = await t.signIn('admin');
    const roles = await json<Role[]>(
      await t.call('GET', '/admin/roles', admin.cookie),
    );
    const adminRole = roles.find((r) => r.name === 'admin')!;
    expect(adminRole.system).toBe(true);
    expect(adminRole.permissions).toEqual([...PERMISSIONS].sort());
    expect(roles.find((r) => r.name === 'student')!.permissions).toEqual([
      'ai.use',
    ]);
  });

  it('makes, edits and deletes a role, and writes each to the audit trail', async () => {
    const admin = await t.signIn('admin');
    const created = await t.call('POST', '/admin/roles', admin.cookie, {
      name: roleName('  Moderators  '.trim()),
      permissions: ['users.view', 'discussion.moderate'],
    });
    expect(created.status).toBe(201);
    const role = await json<Role>(created);
    expect(role.system).toBe(false);
    expect(role.permissions).toEqual(['discussion.moderate', 'users.view']);

    const edited = await t.call(
      'PUT',
      `/admin/roles/${role.id}`,
      admin.cookie,
      {
        permissions: ['users.view', 'ai_reports.review'],
      },
    );
    expect(edited.status).toBe(200);
    expect((await json<Role>(edited)).permissions).toEqual([
      'ai_reports.review',
      'users.view',
    ]);

    expect(
      (await t.call('DELETE', `/admin/roles/${role.id}`, admin.cookie)).status,
    ).toBe(204);
    expect(
      (await t.call('DELETE', `/admin/roles/${role.id}`, admin.cookie)).status,
    ).toBe(404);

    const audit = await json<{ action: string; actorUserId: number }[]>(
      await t.call('GET', '/admin/audit', admin.cookie),
    );
    const mine = audit
      .filter((e) => e.actorUserId === admin.id)
      .map((e) => e.action);
    expect(mine).toEqual(['role.delete', 'role.permissions', 'role.create']);
  });

  it('refuses a bad request with 400, and a name already taken (in any case) with 409', async () => {
    const admin = await t.signIn('admin');
    const post = (body: unknown) =>
      t.call('POST', '/admin/roles', admin.cookie, body);
    expect((await post({ name: roleName('x'), permissions: [] })).status).toBe(
      400,
    );
    expect(
      (await post({ name: roleName('x'), permissions: ['galaxy.rule'] }))
        .status,
    ).toBe(400);
    expect((await post({ name: '   ', permissions: ['ai.use'] })).status).toBe(
      400,
    );
    expect(
      (await post({ name: roleName('x'), permissions: ['ai.use', 'ai.use'] }))
        .status,
    ).toBe(400);
    expect(
      (
        await post({
          name: roleName('x'),
          permissions: ['ai.use'],
          system: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ name: roleName('Dup'), permissions: ['ai.use'] })).status,
    ).toBe(201);
    expect(
      (await post({ name: roleName('DUP'), permissions: ['ai.use'] })).status,
    ).toBe(409);
  });

  it('does not let the admin role be edited, or a system role be deleted', async () => {
    const admin = await t.signIn('admin');
    const roles = await json<Role[]>(
      await t.call('GET', '/admin/roles', admin.cookie),
    );
    const adminRole = roles.find((r) => r.name === 'admin')!;
    const student = roles.find((r) => r.name === 'student')!;
    expect(
      (
        await t.call('PUT', `/admin/roles/${adminRole.id}`, admin.cookie, {
          permissions: ['ai.use'],
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call('DELETE', `/admin/roles/${adminRole.id}`, admin.cookie))
        .status,
    ).toBe(400);
    expect(
      (await t.call('DELETE', `/admin/roles/${student.id}`, admin.cookie))
        .status,
    ).toBe(400);
  });

  it('takes a deleted role away from the users who had it', async () => {
    const admin = await t.signIn('admin');
    const user = await t.signIn();
    const roleId = await t.give(user.id, ['users.view']);
    expect((await t.call('GET', '/admin/users', user.cookie)).status).toBe(200);
    expect(
      (await t.call('DELETE', `/admin/roles/${roleId}`, admin.cookie)).status,
    ).toBe(204);
    expect((await t.call('GET', '/admin/users', user.cookie)).status).toBe(403);
  });
});

describe('nobody climbs', () => {
  /** A manager of roles who may view users and nothing more: enough to try every way up. */
  async function manager() {
    const user = await t.signIn();
    await t.give(user.id, ['roles.manage', 'users.view']);
    return user;
  }

  it('lets a manager make a role only of permissions they hold', async () => {
    const m = await manager();
    const post = (permissions: string[], label: string) =>
      t.call('POST', '/admin/roles', m.cookie, {
        name: roleName(label),
        permissions,
      });
    expect((await post(['ai_credits.grant'], 'up')).status).toBe(403);
    expect((await post(['users.view', 'roles.manage'], 'level')).status).toBe(
      201,
    );
  });

  it('lets a manager give or take away only roles worth no more than their own', async () => {
    const m = await manager();
    const target = await t.signIn();
    const roles = await json<Role[]>(
      await t.call('GET', '/admin/roles', (await t.signIn('admin')).cookie),
    );
    const adminRole = roles.find((r) => r.name === 'admin')!;
    const student = roles.find((r) => r.name === 'student')!;
    const lowRole = await t.give(target.id, ['users.view']);
    const set = (userId: number, roleIds: number[]) =>
      t.call('PUT', `/admin/users/${userId}/roles`, m.cookie, { roleIds });
    expect((await set(target.id, [student.id, adminRole.id])).status).toBe(403);
    // takes away a role worth no more than their own, and gives it back
    expect((await set(target.id, [student.id])).status).toBe(200);
    const after = await json<{ roles: { id: number }[] }>(
      await set(target.id, [student.id, lowRole]),
    );
    expect(after.roles.map((r) => r.id)).toContain(lowRole);
    // and cannot take a role away that they could not have given
    const boss = await t.signIn('admin');
    expect((await set(boss.id, [student.id])).status).toBe(403);
  });

  it('lets a manager edit or delete only a role whose permissions they all hold', async () => {
    const m = await manager();
    const higher = await t.give((await t.signIn()).id, [
      'ai_credits.grant',
      'users.view',
    ]);
    expect(
      (
        await t.call('PUT', `/admin/roles/${higher}`, m.cookie, {
          permissions: ['users.view'],
        })
      ).status,
    ).toBe(403);
    expect(
      (await t.call('DELETE', `/admin/roles/${higher}`, m.cookie)).status,
    ).toBe(403);
  });

  it('lets someone who may only view users see them, and nothing else of the admin area', async () => {
    const viewer = await t.signIn();
    await t.give(viewer.id, ['users.view']);
    expect((await t.call('GET', '/admin/users', viewer.cookie)).status).toBe(
      200,
    );
    expect((await t.call('GET', '/admin/roles', viewer.cookie)).status).toBe(
      403,
    );
    expect((await t.call('GET', '/admin/audit', viewer.cookie)).status).toBe(
      403,
    );
  });
});

describe('users and their roles', () => {
  it('finds a user by part of the login, with the roles they hold', async () => {
    const admin = await t.signIn('admin');
    const found = await json<{
      items: { id: number; roles: { name: string }[] }[];
      total: number;
      pageSize: number;
    }>(await t.call('GET', `/admin/users?q=${t.run}`, admin.cookie));
    expect(found.total).toBeGreaterThan(0);
    const me = found.items.find((u) => u.id === admin.id)!;
    expect(me.roles.map((r) => r.name).sort()).toEqual(['admin', 'student']);
    expect(found.pageSize).toBe(25);
  });

  it('treats % and _ in a search as plain characters, and pages past the end as empty', async () => {
    const admin = await t.signIn('admin');
    const all = await json<{ total: number }>(
      await t.call('GET', '/admin/users', admin.cookie),
    );
    const wild = await json<{ total: number }>(
      await t.call('GET', '/admin/users?q=%25', admin.cookie),
    );
    expect(wild.total).toBeLessThan(all.total);
    const far = await json<{ items: unknown[] }>(
      await t.call('GET', '/admin/users?page=99999', admin.cookie),
    );
    expect(far.items).toEqual([]);
    expect(
      (await t.call('GET', '/admin/users?page=0', admin.cookie)).status,
    ).toBe(400);
  });

  it('changes the roles of a user, ends their sessions, and writes it to the audit trail', async () => {
    const admin = await t.signIn('admin');
    const target = await t.signIn();
    const roles = await json<Role[]>(
      await t.call('GET', '/admin/roles', admin.cookie),
    );
    const student = roles.find((r) => r.name === 'student')!;
    await t.give(target.id, ['users.view']);
    expect((await t.call('GET', '/admin/users', target.cookie)).status).toBe(
      200,
    );

    const res = await t.call(
      'PUT',
      `/admin/users/${target.id}/roles`,
      admin.cookie,
      { roleIds: [student.id] },
    );
    expect(res.status).toBe(200);
    expect(
      (await json<{ roles: { name: string }[] }>(res)).roles.map((r) => r.name),
    ).toEqual(['student']);
    // the old cookie no longer works: the user signs in again under the new roles
    expect((await t.call('GET', '/admin/users', target.cookie)).status).toBe(
      401,
    );

    const audit = await json<
      {
        action: string;
        targetUserId: number;
        detail: { added: string[]; removed: string[] };
      }[]
    >(await t.call('GET', '/admin/audit', admin.cookie));
    const row = audit.find(
      (e) => e.action === 'user.roles' && e.targetUserId === target.id,
    )!;
    expect(row.detail.added).toEqual([]);
    expect(row.detail.removed).toHaveLength(1);
  });

  it('changes nothing, and signs nobody out, when the roles asked for are the roles they have', async () => {
    const admin = await t.signIn('admin');
    const target = await t.signIn();
    const roles = await json<Role[]>(
      await t.call('GET', '/admin/roles', admin.cookie),
    );
    const student = roles.find((r) => r.name === 'student')!;
    expect(
      (
        await t.call('PUT', `/admin/users/${target.id}/roles`, admin.cookie, {
          roleIds: [student.id],
        })
      ).status,
    ).toBe(200);
    expect((await t.call('GET', '/auth/me', target.cookie)).status).toBe(200);
    expect(
      await json<unknown>(await t.call('GET', '/auth/me', target.cookie)),
    ).not.toBeNull();
  });

  it('answers 404 for a user that does not exist and 400 for a role that does not', async () => {
    const admin = await t.signIn('admin');
    const target = await t.signIn();
    expect(
      (
        await t.call('PUT', '/admin/users/2147483000/roles', admin.cookie, {
          roleIds: [],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.call('PUT', `/admin/users/${target.id}/roles`, admin.cookie, {
          roleIds: [2147483000],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call('PUT', `/admin/users/${target.id}/roles`, admin.cookie, {
          roleIds: 'x',
        })
      ).status,
    ).toBe(400);
  });
});

describe('the system is never left without an admin', () => {
  /**
   * Admins other than `mine`, after dropping the admin role from the test users this run made earlier. Any
   * left are real ones: then the test is skipped, so it never touches an account that is not its own.
   */
  const otherAdmins = async (mine: number[]) => {
    await t.dataSource.query(
      `DELETE FROM user_role WHERE "roleId" = (SELECT id FROM role WHERE name = 'admin' AND system)
          AND "userId" <> ALL($1::int[]) AND "userId" IN (SELECT id FROM "user" WHERE "displayName" LIKE $2)`,
      [mine, `% ${t.run}`],
    );
    const rows: { n: number }[] = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM user_role ur JOIN role r ON r.id = ur."roleId"
        WHERE r.name = 'admin' AND r.system AND ur."userId" <> ALL($1::int[])`,
      [mine],
    );
    return rows[0].n;
  };

  it('refuses to take the admin role from the only admin', async (ctx) => {
    const a = await t.signIn('admin');
    if ((await otherAdmins([a.id])) > 0) ctx.skip();
    const res = await t.call('PUT', `/admin/users/${a.id}/roles`, a.cookie, {
      roleIds: [],
    });
    expect(res.status).toBe(409);
    expect((await t.call('GET', '/admin/roles', a.cookie)).status).toBe(200);
  });

  it('lets exactly one of two admins demote the other when both try at the same moment', async (ctx) => {
    const a = await t.signIn('admin');
    const b = await t.signIn('admin');
    if ((await otherAdmins([a.id, b.id])) > 0) ctx.skip();
    const [first, second] = await Promise.all([
      t.call('PUT', `/admin/users/${b.id}/roles`, a.cookie, { roleIds: [] }),
      t.call('PUT', `/admin/users/${a.id}/roles`, b.cookie, { roleIds: [] }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const left: { n: number }[] = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM user_role ur JOIN role r ON r.id = ur."roleId" WHERE r.name = 'admin' AND r.system`,
    );
    expect(left[0].n).toBe(1);
  });
});
