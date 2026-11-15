import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PERMISSIONS, RoleView } from '../../admin/admin.model';
import { AdminService, adminErrorOf } from '../../admin/admin.service';
import { AuthService } from '../../services/auth.service';
import { Notice, errorText } from './admin-format';

interface Draft {
  /** `null` is a new role. */
  id: number | null;
  name: string;
  permissions: string[];
  limit: number;
}

/** Roles are bundles of permissions plus a daily credit limit. The `admin` role always holds everything, so it is not edited. */
@Component({
  selector: 'app-admin-roles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-roles.html',
  styleUrl: './admin.css',
})
export class AdminRoles {
  private admin = inject(AdminService);
  protected auth = inject(AuthService);

  protected readonly permissions = PERMISSIONS;
  protected readonly canManage = computed(() => this.auth.can('roles.manage'));
  protected roles = signal<RoleView[] | null>(null);
  protected draft = signal<Draft | null>(null);
  protected confirmDelete = signal<number | null>(null);
  protected notice = signal<Notice | null>(null);
  protected busy = signal(false);

  constructor() {
    void this.load();
  }

  protected edit(role: RoleView | null): void {
    this.notice.set(null);
    this.confirmDelete.set(null);
    this.draft.set(
      role
        ? {
            id: role.id,
            name: role.name,
            permissions: [...role.permissions],
            limit: role.aiDailyCreditLimit,
          }
        : { id: null, name: '', permissions: [], limit: 0 },
    );
  }

  protected patch(change: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }

  protected toggle(permission: string, on: boolean): void {
    const d = this.draft();
    if (!d) return;
    this.patch({
      permissions: on
        ? [...d.permissions, permission]
        : d.permissions.filter((p) => p !== permission),
    });
  }

  protected valid(): boolean {
    const d = this.draft();
    return (
      !!d &&
      d.permissions.length > 0 &&
      (d.id !== null || d.name.trim().length > 0) &&
      Number.isInteger(d.limit) &&
      d.limit >= 0
    );
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || !this.valid() || this.busy()) return;
    this.busy.set(true);
    try {
      if (d.id === null) await this.admin.createRole(d.name.trim(), d.permissions, d.limit);
      else await this.admin.updateRole(d.id, d.permissions, d.limit);
      this.draft.set(null);
      this.notice.set({ kind: 'success', text: $localize`:@@admin.saved:Saved.` });
      await this.load();
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    } finally {
      this.busy.set(false);
    }
  }

  /** Two steps, like everywhere else: the first click asks, the second deletes. */
  protected async remove(role: RoleView): Promise<void> {
    if (this.confirmDelete() !== role.id) {
      this.confirmDelete.set(role.id);
      return;
    }
    this.busy.set(true);
    try {
      await this.admin.deleteRole(role.id);
      this.confirmDelete.set(null);
      this.notice.set({ kind: 'success', text: $localize`:@@admin.roles.deleted:Role deleted.` });
      await this.load();
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.roles.set(await this.admin.roles());
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    }
  }
}
