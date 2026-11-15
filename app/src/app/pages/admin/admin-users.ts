import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AdminUser,
  AdminUserPage,
  CreditGrant,
  RoleView,
  UserCredits,
} from '../../admin/admin.model';
import { AdminService, adminErrorOf } from '../../admin/admin.service';
import { AuthService } from '../../services/auth.service';
import { Notice, errorText, usd, when } from './admin-format';

const REVERSAL = 4;

/** Accounts: search, roles, balance, grant and reverse credits, and what the person spent. */
@Component({
  selector: 'app-admin-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-users.html',
  styleUrl: './admin.css',
})
export class AdminUsers {
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private locale = inject(LOCALE_ID);

  protected readonly canRoles = computed(() => this.auth.can('roles.manage'));
  protected readonly canGrant = computed(() => this.auth.can('ai_credits.grant'));
  /** The server refuses a grant to oneself, so the form is replaced by a line saying so. */
  protected readonly isSelf = computed(() => this.selected()?.id === this.auth.currentUser()?.id);
  protected readonly canReverse = computed(() => this.auth.can('ai_credits.reverse'));

  protected query = signal('');
  protected page = signal(1);
  protected data = signal<AdminUserPage | null>(null);
  protected roles = signal<RoleView[]>([]);
  protected notice = signal<Notice | null>(null);

  protected selected = signal<AdminUser | null>(null);
  protected credits = signal<UserCredits | null>(null);
  protected chosenRoles = signal<number[]>([]);
  protected amount = signal(0);
  protected reason = signal('');
  protected reversing = signal<string | null>(null);
  protected reverseReason = signal('');
  protected busy = signal(false);

  protected readonly pages = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });
  protected readonly reversed = computed(
    () =>
      new Set(
        (this.credits()?.grants ?? []).map((g) => g.reversesGrantId).filter((id) => id !== null),
      ),
  );
  protected readonly rolesChanged = computed(() => {
    const user = this.selected();
    const chosen = this.chosenRoles();
    return (
      !!user &&
      (chosen.length !== user.roles.length || user.roles.some((r) => !chosen.includes(r.id)))
    );
  });
  protected readonly grantValid = computed(
    () =>
      Number.isInteger(this.amount()) &&
      this.amount() >= 1 &&
      this.amount() <= 1_000_000 &&
      this.reason().trim().length >= 1,
  );

  constructor() {
    void this.load();
    this.admin.roles().then(
      (roles) => this.roles.set(roles),
      () => {},
    );
  }

  protected search(q: string): void {
    this.query.set(q.trim());
    this.page.set(1);
    void this.load();
  }

  protected go(delta: number): void {
    this.page.update((p) => Math.min(this.pages(), Math.max(1, p + delta)));
    void this.load();
  }

  protected async open(user: AdminUser): Promise<void> {
    this.selected.set(user);
    this.chosenRoles.set(user.roles.map((r) => r.id));
    this.credits.set(null);
    this.amount.set(0);
    this.reason.set('');
    this.reversing.set(null);
    this.notice.set(null);
    await this.loadCredits(user.id);
  }

  protected toggleRole(id: number, on: boolean): void {
    this.chosenRoles.update((list) => (on ? [...list, id] : list.filter((r) => r !== id)));
  }

  protected async saveRoles(): Promise<void> {
    const user = this.selected();
    if (!user || this.busy()) return;
    await this.run(async () => {
      await this.admin.setUserRoles(user.id, this.chosenRoles());
      await this.load();
      this.reselect(user.id);
    });
  }

  protected async grant(): Promise<void> {
    const user = this.selected();
    if (!user || !this.grantValid() || this.busy()) return;
    await this.run(async () => {
      await this.admin.grant(user.id, this.amount(), this.reason().trim());
      this.amount.set(0);
      this.reason.set('');
      await Promise.all([this.loadCredits(user.id), this.load()]);
      this.reselect(user.id);
    });
  }

  protected async reverse(grant: CreditGrant): Promise<void> {
    const user = this.selected();
    if (!user || this.busy()) return;
    if (this.reversing() !== grant.id) {
      this.reversing.set(grant.id);
      this.reverseReason.set('');
      return;
    }
    if (!this.reverseReason().trim()) return;
    await this.run(async () => {
      await this.admin.reverse(grant.id, this.reverseReason().trim());
      this.reversing.set(null);
      await Promise.all([this.loadCredits(user.id), this.load()]);
      this.reselect(user.id);
    });
  }

  protected kind(kind: number): string {
    switch (kind) {
      case 1:
        return $localize`:@@admin.users.kind.grant:Admin grant`;
      case 2:
        return $localize`:@@admin.users.kind.purchase:Purchase`;
      case 3:
        return $localize`:@@admin.users.kind.allowance:Daily allowance`;
      default:
        return $localize`:@@admin.users.kind.reversal:Reversal`;
    }
  }

  protected canBeReversed(grant: CreditGrant): boolean {
    return grant.kind !== REVERSAL && !this.reversed().has(grant.id);
  }

  protected usd(value: number): string {
    return usd(value, this.locale);
  }

  protected when(iso: string): string {
    return when(iso, this.locale);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.notice.set({ kind: 'success', text: $localize`:@@admin.saved:Saved.` });
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await this.admin.users(this.query(), this.page()));
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    }
  }

  private async loadCredits(userId: number): Promise<void> {
    try {
      const credits = await this.admin.credits(userId);
      if (this.selected()?.id === userId) this.credits.set(credits);
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    }
  }

  /** After a reload of the list, the open person is the fresh row of the same id (new balance, new roles). */
  private reselect(id: number): void {
    const fresh = this.data()?.items.find((u) => u.id === id);
    if (fresh) {
      this.selected.set(fresh);
      this.chosenRoles.set(fresh.roles.map((r) => r.id));
    }
  }
}
