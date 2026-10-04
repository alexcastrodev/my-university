import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { FeedArea, FeedItem } from '../../models/feed.model';
import { AuthService } from '../../services/auth.service';
import { FeedService } from '../../services/feed.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { areaBreadcrumb } from '../../shared/area-labels';

const PATH = '/feed';
/** Start fetching the next page while this many cards are still ahead of the one on screen. */
const PREFETCH_CARDS = 3;

interface AreaChip {
  area: FeedArea;
  label: string;
}

/**
 * "Feed" (mobile mockup v2): one concept per screen, scrolled vertically with snap, from every
 * area at once or from one area via the chips. Each card is the concept's own title, summary
 * and first real code snippet, with "Got it" right there so marking something you already
 * know costs one tap.
 */
@Component({
  selector: 'app-feed-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './feed-page.html',
  styleUrl: './feed-page.css',
})
export class FeedPage implements OnInit {
  protected auth = inject(AuthService);
  private feedService = inject(FeedService);
  private xpService = inject(XpService);
  private seo = inject(SeoService);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly chips: AreaChip[] = [
    { area: 'all', label: $localize`:@@feed.area.all:All` },
    { area: 'java', label: 'Java' },
    { area: 'spring', label: 'Spring' },
    { area: 'cs', label: $localize`:@@feed.area.cs:CS` },
    { area: 'databases', label: $localize`:@@area.group.databases:Databases` },
    { area: 'system-design', label: $localize`:@@header.nav.systemDesign:System Design` },
    { area: 'kubernetes', label: 'Kubernetes' },
    { area: 'algorithms', label: $localize`:@@area.group.algorithms:Algorithms` },
    { area: 'quarkus', label: 'Quarkus' },
    { area: 'ruby', label: 'Ruby' },
    { area: 'dotnet', label: '.NET' },
  ];

  /** Summary lines drawn by the first-load placeholder card. */
  protected readonly skeletonLines = [0, 1, 2, 3, 4];

  protected readonly area = signal<FeedArea>('all');
  protected readonly items = signal<FeedItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly gotItToday = signal(0);
  protected readonly marking = signal<ReadonlySet<string>>(new Set());
  private nextOffset: number | null = 0;
  /** The page request in flight, cancelled when the area changes so its late answer can't land. */
  private inflight?: Subscription;

  ngOnInit(): void {
    this.seo.set({
      title: 'Feed',
      description: $localize`:@@feed.seo.description:One concept per screen, from every area you study. Scroll, read, mark what you already know.`,
      path: PATH,
    });
    this.loadMore();
  }

  selectArea(area: FeedArea): void {
    if (area === this.area()) return;
    this.area.set(area);
    this.items.set([]);
    this.nextOffset = 0;
    this.inflight?.unsubscribe();
    this.loading.set(false);
    this.scroller()?.nativeElement.scrollTo({ top: 0 });
    this.loadMore();
  }

  onScroll(): void {
    const el = this.scroller()?.nativeElement;
    if (!el || el.clientHeight === 0) return;
    const remaining = (el.scrollHeight - el.scrollTop - el.clientHeight) / el.clientHeight;
    if (remaining < PREFETCH_CARDS) this.loadMore();
  }

  loadMore(): void {
    if (this.loading() || this.nextOffset === null) return;
    this.loading.set(true);
    this.error.set(false);
    this.inflight = this.feedService.page(this.area(), this.nextOffset).subscribe({
      next: (page) => {
        this.items.update((items) => [...items, ...page.items]);
        this.nextOffset = page.nextOffset;
        this.gotItToday.set(page.gotItToday);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }

  gotIt(item: FeedItem): void {
    const key = this.key(item);
    if (item.read || this.marking().has(key)) return;
    this.marking.update((set) => new Set(set).add(key));
    this.feedService.gotIt(item).subscribe({
      next: (res) => {
        this.items.update((items) =>
          items.map((i) => (this.key(i) === key ? { ...i, read: true } : i)),
        );
        this.gotItToday.set(res.gotItToday);
        this.unmark(key);
        this.xpService.loadSummary();
      },
      error: () => this.unmark(key),
    });
  }

  key(item: FeedItem): string {
    return `${item.module}/${item.discipline ?? ''}/${item.slug}`;
  }

  breadcrumb(item: FeedItem): string {
    return areaBreadcrumb(item.module, item.discipline).join(' › ');
  }

  private unmark(key: string): void {
    this.marking.update((set) => {
      const next = new Set(set);
      next.delete(key);
      return next;
    });
  }
}
