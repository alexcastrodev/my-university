import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminReport, ReportStatus } from '../../admin/admin.model';
import { AdminService, adminErrorOf } from '../../admin/admin.service';
import { answerToPlain } from '../../kurz/kurz-text';
import { Notice, errorText, when } from './admin-format';

type Filter = ReportStatus | 'all';

/**
 * The reports of a wrong Kurz answer. A report is a copy of the exchange and carries nothing of who sent it:
 * the reviewer reads the exchange, opens the post when the post was the error, and closes the report.
 */
@Component({
  selector: 'app-admin-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './admin-reports.html',
  styleUrl: './admin.css',
})
export class AdminReports {
  private admin = inject(AdminService);
  private locale = inject(LOCALE_ID);

  protected readonly filters = computed<{ id: Filter; label: string }[]>(() => [
    { id: 'open', label: $localize`:@@admin.reports.open:Open` },
    { id: 'reviewed', label: $localize`:@@admin.reports.reviewed:Reviewed` },
    { id: 'dismissed', label: $localize`:@@admin.reports.dismissed:Dismissed` },
    { id: 'all', label: $localize`:@@admin.reports.all:All` },
  ]);
  protected filter = signal<Filter>('open');
  protected page = signal(1);
  protected reports = signal<AdminReport[] | null>(null);
  protected notice = signal<Notice | null>(null);

  constructor() {
    void this.load();
  }

  protected setFilter(filter: Filter): void {
    this.filter.set(filter);
    this.page.set(1);
    void this.load();
  }

  protected go(delta: number): void {
    this.page.update((p) => Math.max(1, p + delta));
    void this.load();
  }

  protected async review(report: AdminReport, status: 'reviewed' | 'dismissed'): Promise<void> {
    try {
      await this.admin.reviewReport(report.id, status);
      this.notice.set({ kind: 'success', text: $localize`:@@admin.saved:Saved.` });
      await this.load();
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    }
  }

  protected answer(report: AdminReport): string {
    return answerToPlain(report.answer);
  }

  protected when(iso: string): string {
    return when(iso, this.locale);
  }

  private async load(): Promise<void> {
    try {
      this.reports.set(await this.admin.reports(this.filter(), this.page()));
    } catch (error) {
      this.notice.set({ kind: 'error', text: errorText(adminErrorOf(error)) });
    }
  }
}
