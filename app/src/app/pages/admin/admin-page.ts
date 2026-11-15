import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlatformBudget } from '../../admin/admin.model';
import { AdminService } from '../../admin/admin.service';
import { AuthService } from '../../services/auth.service';
import { AdminAudit } from './admin-audit';
import { usd } from './admin-format';
import { AdminReports } from './admin-reports';
import { AdminRoles } from './admin-roles';
import { AdminUsers } from './admin-users';

type Tab = 'users' | 'roles' | 'reports' | 'audit';

/**
 * The admin screen (#322): users and their credits, roles, the reports of wrong Kurz answers, the audit trail,
 * and how much of the platform budget is spent. Each tab shows only when the account holds its permission; the
 * server checks every call again.
 */
@Component({
  selector: 'app-admin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AdminUsers, AdminRoles, AdminReports, AdminAudit],
  templateUrl: './admin-page.html',
  styleUrl: './admin.css',
})
export class AdminPage {
  protected auth = inject(AuthService);
  private admin = inject(AdminService);
  private locale = inject(LOCALE_ID);

  protected readonly allowed = computed(() => this.auth.can('admin.access'));
  protected readonly tabs = computed<{ id: Tab; label: string }[]>(() => [
    ...(this.auth.can('users.view')
      ? [{ id: 'users' as const, label: $localize`:@@admin.tab.users:Users` }]
      : []),
    { id: 'roles' as const, label: $localize`:@@admin.tab.roles:Roles` },
    ...(this.auth.can('ai_reports.review')
      ? [{ id: 'reports' as const, label: $localize`:@@admin.tab.reports:Kurz reports` }]
      : []),
    { id: 'audit' as const, label: $localize`:@@admin.tab.audit:Audit` },
  ]);
  private chosen = signal<Tab | null>(null);
  protected readonly current = computed(() => {
    const tabs = this.tabs();
    return tabs.find((t) => t.id === this.chosen())?.id ?? tabs[0].id;
  });

  protected budget = signal<PlatformBudget | null>(null);

  constructor() {
    effect(() => {
      if (this.allowed()) void this.loadBudget();
    });
  }

  protected choose(tab: Tab): void {
    this.chosen.set(tab);
  }

  protected usd(value: number): string {
    return usd(value, this.locale);
  }

  protected percent(spent: number, budget: number): number {
    return budget > 0 ? Math.round((spent / budget) * 100) : 0;
  }

  private async loadBudget(): Promise<void> {
    try {
      this.budget.set(await this.admin.budget());
    } catch {
      // The strip is an extra: without it the tabs still work.
    }
  }
}
