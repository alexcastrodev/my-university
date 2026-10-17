import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MARKER_PARAM } from '../../discussion/discussion.service';
import { timeAgo } from '../../discussion/time-ago';
import { AuthService } from '../../services/auth.service';
import { NotificationItem, NotificationService } from '../../services/notification.service';
import { SeoService } from '../../services/seo.service';

/** Replies to the reader's comments, newest first. Each row opens the lab tab or the paragraph discussion it came from. */
@Component({
  selector: 'app-notifications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './notifications-page.html',
  styleUrl: './notifications-page.css',
})
export class NotificationsPage implements OnInit {
  protected notifications = inject(NotificationService);
  protected auth = inject(AuthService);
  private seo = inject(SeoService);
  private locale = inject(LOCALE_ID);

  constructor() {
    effect(() => {
      if (this.auth.currentUser()) untracked(() => this.notifications.load());
    });
  }

  ngOnInit(): void {
    this.seo.set({
      title: $localize`:@@notifications.title:Notifications`,
      description: 'Replies to your comments.',
      path: '/notifications',
    });
  }

  protected query(item: NotificationItem): Record<string, string | number> {
    return item.lab ? { tab: 'lab' } : { [MARKER_PARAM]: item.markerId };
  }

  protected ago(iso: string): string {
    return timeAgo(iso, this.locale);
  }
}
