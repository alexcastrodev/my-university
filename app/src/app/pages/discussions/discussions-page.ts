import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  OnInit,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DiscussionFeedService } from '../../discussion/discussion-feed.service';
import { FeedItem, FeedScope } from '../../discussion/discussion.model';
import { MARKER_PARAM } from '../../discussion/discussion.service';
import { timeAgo } from '../../discussion/time-ago';
import { AuthService } from '../../services/auth.service';
import { SeoService } from '../../services/seo.service';
import { areaLabel } from '../../shared/area-labels';

/**
 * Every paragraph discussion across the site, most recent activity first, with tabs for the
 * reader's own threads and the ones they joined, and a chip per area. Pages load by cursor
 * ("Load more"), never by page number.
 */
@Component({
  selector: 'app-discussions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  providers: [DiscussionFeedService],
  templateUrl: './discussions-page.html',
  styleUrl: './discussions-page.css',
})
export class DiscussionsPage implements OnInit {
  protected feed = inject(DiscussionFeedService);
  private auth = inject(AuthService);
  private seo = inject(SeoService);
  private locale = inject(LOCALE_ID);

  protected readonly tabs: { scope: FeedScope; label: string }[] = [
    { scope: 'all', label: $localize`:@@discussions.tab.all:All` },
    { scope: 'mine', label: $localize`:@@discussions.tab.mine:Mine` },
    { scope: 'participated', label: $localize`:@@discussions.tab.participated:Participated` },
  ];

  protected total = computed(() => this.feed.areas().reduce((sum, a) => sum + a.count, 0));

  constructor() {
    // Signing in or out changes what the personal tabs show and the "by you" flags.
    effect(() => {
      this.auth.currentUser()?.id;
      this.feed.scope();
      untracked(() => void this.feed.loadAreas());
    });
    effect(() => {
      this.auth.currentUser()?.id;
      this.feed.scope();
      this.feed.area();
      untracked(() => void this.feed.load());
    });
  }

  ngOnInit(): void {
    this.seo.set({
      title: $localize`:@@discussions.title:Discussions`,
      description: 'Paragraph discussions across every area, most recent activity first.',
      path: '/discussions',
    });
  }

  protected areaLabel(area: string): string {
    return areaLabel(area) || area;
  }

  protected timeAgo(iso: string): string {
    return timeAgo(iso, this.locale);
  }

  protected markerQuery(item: FeedItem): Record<string, number> {
    return { [MARKER_PARAM]: item.markerId };
  }

  protected commentsAria(count: number): string {
    return $localize`:@@discussions.commentsAria:${count}:count: comments`;
  }
}
