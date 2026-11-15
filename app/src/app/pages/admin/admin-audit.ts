import { ChangeDetectionStrategy, Component, LOCALE_ID, inject, signal } from '@angular/core';
import { AuditEvent } from '../../admin/admin.model';
import { AdminService } from '../../admin/admin.service';
import { when } from './admin-format';

/** The latest 100 changes of roles, credits and accounts, with who made each (nobody: the command line). */
@Component({
  selector: 'app-admin-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-audit.html',
  styleUrl: './admin.css',
})
export class AdminAudit {
  private admin = inject(AdminService);
  private locale = inject(LOCALE_ID);

  protected events = signal<AuditEvent[] | null>(null);
  protected failed = signal(false);

  constructor() {
    this.admin.audit().then(
      (events) => this.events.set(events),
      () => this.failed.set(true),
    );
  }

  protected when(iso: string): string {
    return when(iso, this.locale);
  }

  protected detail(event: AuditEvent): string {
    return event.detail ? JSON.stringify(event.detail) : '';
  }
}
