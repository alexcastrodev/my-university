/**
 * Maintenance CLI for roles. From backend/: `pnpm roles <command>`; in the API image: `node dist/auth/cli.js <command>`.
 *
 *   make-admin <github-login>   give a user the `admin` role. This is how the first admin is made: there is
 *                               no open endpoint for it. The change is written to `admin_audit_event` with
 *                               no actor. Re-running changes nothing.
 *
 * The `admin` role holds every permission once the API has booted (see `PermissionsService`).
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';

export async function makeAdmin(
  dataSource: DataSource,
  login: string,
): Promise<string> {
  const users: { id: number }[] = await dataSource.query(
    `SELECT id FROM "user" WHERE "githubLogin" = $1 ORDER BY id`,
    [login],
  );
  if (users.length === 0)
    throw new Error(`no user with the GitHub login ${login}`);
  if (users.length > 1)
    throw new Error(
      `${users.length} users have the GitHub login ${login} (ids ${users.map((u) => u.id).join(', ')}); a login can be renamed, so say which`,
    );
  const userId = users[0].id;
  return dataSource.transaction(async (m) => {
    const given: unknown[] = await m.query(
      `INSERT INTO user_role ("userId", "roleId") SELECT $1, id FROM role WHERE name = 'admin' ON CONFLICT DO NOTHING RETURNING "roleId"`,
      [userId],
    );
    if (given.length === 0) {
      const has: unknown[] = await m.query(
        `SELECT 1 FROM user_role ur JOIN role r ON r.id = ur."roleId" WHERE ur."userId" = $1 AND r.name = 'admin'`,
        [userId],
      );
      if (has.length === 0)
        throw new Error(
          'the admin role does not exist: run the migrations first',
        );
      return `user ${userId} is already an admin`;
    }
    await m.query(
      `INSERT INTO admin_audit_event ("targetUserId", "action", "detail") VALUES ($1, 'user.role.add', $2)`,
      [userId, JSON.stringify({ role: 'admin', via: 'cli' })],
    );
    return `user ${userId} is now an admin`;
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'make-admin' || args.length !== 1) {
    console.error('usage: roles make-admin <github-login>');
    process.exit(1);
  }
  const dataSource = new DataSource({
    type: 'postgres',
    url:
      process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/ocp_java',
  });
  await dataSource.initialize();
  try {
    console.log(await makeAdmin(dataSource, args[0]));
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
