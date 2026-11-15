import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Permission, PERMISSIONS } from './permissions';

/**
 * Reads what a user may do, and the epoch their session must carry (#322). Everything comes from the database
 * on each request, never from the cookie: a role changed by an admin takes effect at the next request.
 */
@Injectable()
export class PermissionsService implements OnApplicationBootstrap {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** The `admin` role holds every permission in the code, so one added to the list reaches it on the next boot. */
  async onApplicationBootstrap(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO role_permission ("roleId", "permission")
       SELECT r.id, p FROM role r CROSS JOIN unnest($1::text[]) AS p
        WHERE r.name = 'admin' AND r.system
       ON CONFLICT DO NOTHING`,
      [PERMISSIONS],
    );
  }

  /** The union of the permissions of every role the user has. Names not in the code's list are ignored. */
  async permissionsOf(userId: number): Promise<Permission[]> {
    const rows: { permission: string }[] = await this.dataSource.query(
      `SELECT DISTINCT rp.permission FROM user_role ur
         JOIN role_permission rp ON rp."roleId" = ur."roleId"
        WHERE ur."userId" = $1`,
      [userId],
    );
    const known = new Set<string>(PERMISSIONS);
    return rows
      .map((r) => r.permission)
      .filter((p): p is Permission => known.has(p));
  }

  async has(userId: number, permission: Permission): Promise<boolean> {
    return (await this.permissionsOf(userId)).includes(permission);
  }

  /** The user's current epoch, or null when there is no such user (a deleted account loses its sessions too). */
  async sessionEpoch(userId: number): Promise<number | null> {
    const rows: { sessionEpoch: number }[] = await this.dataSource.query(
      `SELECT "sessionEpoch" FROM "user" WHERE id = $1`,
      [userId],
    );
    return rows[0]?.sessionEpoch ?? null;
  }

  /** Signs the user out everywhere: every cookie issued under the old epoch stops being honoured. */
  async bumpEpoch(userId: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE "user" SET "sessionEpoch" = "sessionEpoch" + 1 WHERE id = $1`,
      [userId],
    );
  }
}
