import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { recordAudit } from '../auth/audit';
import { holdsAll } from '../auth/permissions';
import { PermissionsService } from '../auth/permissions.service';
import { USERS_PAGE_SIZE } from './admin.dto';

export interface RoleView {
  id: number;
  name: string;
  system: boolean;
  permissions: string[];
  aiDailyCreditLimit: number;
  users: number;
}

export interface AdminUserView {
  id: number;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
  createdAt: string;
  /** Credits left (see `AiCreditsService.balance`). */
  balance: number;
  roles: { id: number; name: string }[];
}

/** Permissions in the order of the code's own string comparison, not of the database's collation. */
const sorted = (role: RoleView): RoleView => ({
  ...role,
  permissions: [...role.permissions].sort(),
});

/** One lock for every change of who is an admin, so two of them cannot demote each other at once. */
const ADMIN_CHANGE_LOCK = 4_220_001;

/**
 * Roles, who has them, and the trail of both (#322). Every change runs in one transaction with its audit row.
 * A change is refused with 403 unless the actor holds every permission of every role it touches (no climbing),
 * and the system can never be left without an admin.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
  ) {}

  async listRoles(): Promise<RoleView[]> {
    const rows: RoleView[] = await this.dataSource.query(
      `SELECT r.id, r.name, r.system, r."aiDailyCreditLimit",
              COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions,
              (SELECT count(*) FROM user_role ur WHERE ur."roleId" = r.id)::int AS users
         FROM role r LEFT JOIN role_permission rp ON rp."roleId" = r.id
        GROUP BY r.id ORDER BY r.system DESC, lower(r.name)`,
    );
    return rows.map(sorted);
  }

  async createRole(
    actorId: number,
    name: string,
    permissions: string[],
    aiDailyCreditLimit = 0,
  ): Promise<RoleView> {
    await this.mustHold(actorId, permissions);
    if (aiDailyCreditLimit !== 0)
      await this.mustHold(actorId, ['ai_credits.grant']);
    return this.dataSource.transaction(async (m) => {
      let id: number;
      try {
        const rows: { id: number }[] = await m.query(
          `INSERT INTO role (name, "aiDailyCreditLimit") VALUES ($1, $2) RETURNING id`,
          [name, aiDailyCreditLimit],
        );
        id = rows[0].id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('A role with that name already exists');
        throw error;
      }
      await this.setRolePermissions(m, id, permissions);
      await this.audit(m, actorId, null, 'role.create', {
        name,
        permissions,
        aiDailyCreditLimit,
      });
      return this.roleView(m, id);
    });
  }

  /** Replaces what a role holds. The admin role is not editable: it holds everything, kept in step with the code. */
  async updateRole(
    actorId: number,
    id: number,
    permissions: string[],
    aiDailyCreditLimit?: number,
  ): Promise<RoleView> {
    return this.dataSource.transaction(async (m) => {
      const role = await this.roleView(m, id);
      if (role.system && role.name === 'admin')
        throw new BadRequestException(
          'The admin role always holds every permission',
        );
      await this.mustHold(actorId, [...role.permissions, ...permissions]);
      const added = permissions.filter((p) => !role.permissions.includes(p));
      const removed = role.permissions.filter((p) => !permissions.includes(p));
      const limit = aiDailyCreditLimit ?? role.aiDailyCreditLimit;
      const limitChanged = limit !== role.aiDailyCreditLimit;
      if (added.length === 0 && removed.length === 0 && !limitChanged)
        return role;
      if (limitChanged) await this.mustHold(actorId, ['ai_credits.grant']);
      await this.setRolePermissions(m, id, permissions);
      if (limitChanged)
        await m.query(
          `UPDATE role SET "aiDailyCreditLimit" = $2 WHERE id = $1`,
          [id, limit],
        );
      await this.audit(m, actorId, null, 'role.permissions', {
        role: role.name,
        added,
        removed,
        ...(limitChanged
          ? { aiDailyCreditLimit: { from: role.aiDailyCreditLimit, to: limit } }
          : {}),
      });
      return this.roleView(m, id);
    });
  }

  async deleteRole(actorId: number, id: number): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const role = await this.roleView(m, id);
      if (role.system)
        throw new BadRequestException('A system role cannot be deleted');
      await this.mustHold(actorId, role.permissions);
      await m.query(`DELETE FROM role WHERE id = $1`, [id]);
      await this.audit(m, actorId, null, 'role.delete', {
        name: role.name,
        permissions: role.permissions,
        users: role.users,
      });
    });
  }

  async listUsers(
    q: string | undefined,
    page = 1,
  ): Promise<{
    items: AdminUserView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const where = `($1::text IS NULL OR u."githubLogin" ILIKE $1 OR u."displayName" ILIKE $1 OR u."displayNameOverride" ILIKE $1)`;
    const total: { n: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM "user" u WHERE ${where}`,
      [like],
    );
    const items: AdminUserView[] = await this.dataSource.query(
      `SELECT u.id, u."githubLogin", COALESCE(u."displayNameOverride", u."displayName") AS "displayName", u."avatarUrl", u."createdAt",
              (COALESCE((SELECT SUM(amount) FROM ai_credit_grant WHERE "userId" = u.id), 0) - COALESCE((SELECT SUM(credits) FROM ai_usage WHERE "userId" = u.id), 0))::int AS balance,
              COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
                          FROM user_role ur JOIN role r ON r.id = ur."roleId" WHERE ur."userId" = u.id), '[]') AS roles
         FROM "user" u WHERE ${where}
        ORDER BY u.id DESC LIMIT ${USERS_PAGE_SIZE} OFFSET ${(page - 1) * USERS_PAGE_SIZE}`,
      [like],
    );
    return { items, total: total[0].n, page, pageSize: USERS_PAGE_SIZE };
  }

  /**
   * Replaces the roles of a user. Under one lock, so that two admins cannot demote each other at the same
   * time and leave nobody. The user's sessions end (the epoch rises): they sign in again under the new roles.
   */
  async setUserRoles(
    actorId: number,
    userId: number,
    roleIds: number[],
  ): Promise<AdminUserView> {
    const actor = await this.permissions.permissionsOf(actorId);
    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock($1)`, [ADMIN_CHANGE_LOCK]);
      const user: unknown[] = await m.query(
        `SELECT 1 FROM "user" WHERE id = $1`,
        [userId],
      );
      if (user.length === 0) throw new NotFoundException();
      const all = await this.listRolesIn(m);
      const wanted = [...new Set(roleIds)];
      const unknown = wanted.filter((id) => !all.some((r) => r.id === id));
      if (unknown.length)
        throw new BadRequestException(`No such role: ${unknown.join(', ')}`);
      const current: { roleId: number }[] = await m.query(
        `SELECT "roleId" FROM user_role WHERE "userId" = $1`,
        [userId],
      );
      const had = current.map((r) => r.roleId);
      const added = all.filter(
        (r) => wanted.includes(r.id) && !had.includes(r.id),
      );
      const removed = all.filter(
        (r) => had.includes(r.id) && !wanted.includes(r.id),
      );
      for (const role of [...added, ...removed]) {
        if (!holdsAll(actor, role.permissions)) throw new ForbiddenException();
      }
      if (added.length || removed.length) {
        for (const role of removed)
          await m.query(
            `DELETE FROM user_role WHERE "userId" = $1 AND "roleId" = $2`,
            [userId, role.id],
          );
        for (const role of added)
          await m.query(
            `INSERT INTO user_role ("userId", "roleId") VALUES ($1, $2)`,
            [userId, role.id],
          );
        const admins: { n: number }[] = await m.query(
          `SELECT count(*)::int AS n FROM user_role ur JOIN role r ON r.id = ur."roleId" WHERE r.name = 'admin' AND r.system`,
        );
        if (admins[0].n === 0)
          throw new ConflictException(
            'The system cannot be left without an admin',
          );
        await m.query(
          `UPDATE "user" SET "sessionEpoch" = "sessionEpoch" + 1 WHERE id = $1`,
          [userId],
        );
        await this.audit(m, actorId, userId, 'user.roles', {
          added: added.map((r) => r.name),
          removed: removed.map((r) => r.name),
        });
      }
      return this.userView(m, userId);
    });
  }

  /** The latest changes, newest first, with who made them (null: the CLI). */
  async recentAudit(): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT e.id, e.action, e.detail, e."createdAt", e."actorUserId", a."githubLogin" AS "actorLogin",
              e."targetUserId", t."githubLogin" AS "targetLogin"
         FROM admin_audit_event e
         LEFT JOIN "user" a ON a.id = e."actorUserId"
         LEFT JOIN "user" t ON t.id = e."targetUserId"
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 100`,
    );
  }

  private async mustHold(actorId: number, needed: string[]): Promise<void> {
    if (!holdsAll(await this.permissions.permissionsOf(actorId), needed))
      throw new ForbiddenException();
  }

  private async setRolePermissions(
    m: EntityManager,
    roleId: number,
    permissions: string[],
  ): Promise<void> {
    await m.query(`DELETE FROM role_permission WHERE "roleId" = $1`, [roleId]);
    await m.query(
      `INSERT INTO role_permission ("roleId", permission) SELECT $1, unnest($2::text[])`,
      [roleId, permissions],
    );
  }

  private audit(
    m: EntityManager,
    actorId: number,
    targetId: number | null,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    return recordAudit(m, actorId, targetId, action, detail);
  }

  private async listRolesIn(m: EntityManager): Promise<RoleView[]> {
    return m.query(
      `SELECT r.id, r.name, r.system, r."aiDailyCreditLimit",
              COALESCE(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions, 0 AS users
         FROM role r LEFT JOIN role_permission rp ON rp."roleId" = r.id GROUP BY r.id`,
    );
  }

  private async roleView(m: EntityManager, id: number): Promise<RoleView> {
    const rows: RoleView[] = await m.query(
      `SELECT r.id, r.name, r.system, r."aiDailyCreditLimit",
              COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions,
              (SELECT count(*) FROM user_role ur WHERE ur."roleId" = r.id)::int AS users
         FROM role r LEFT JOIN role_permission rp ON rp."roleId" = r.id WHERE r.id = $1 GROUP BY r.id`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException();
    return sorted(rows[0]);
  }

  private async userView(m: EntityManager, id: number): Promise<AdminUserView> {
    const rows: AdminUserView[] = await m.query(
      `SELECT u.id, u."githubLogin", COALESCE(u."displayNameOverride", u."displayName") AS "displayName", u."avatarUrl", u."createdAt",
              (COALESCE((SELECT SUM(amount) FROM ai_credit_grant WHERE "userId" = u.id), 0) - COALESCE((SELECT SUM(credits) FROM ai_usage WHERE "userId" = u.id), 0))::int AS balance,
              COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY r.name)
                          FROM user_role ur JOIN role r ON r.id = ur."roleId" WHERE ur."userId" = u.id), '[]') AS roles
         FROM "user" u WHERE u.id = $1`,
      [id],
    );
    return rows[0];
  }
}
