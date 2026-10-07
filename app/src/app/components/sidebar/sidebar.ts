import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  HostListener,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { catchError, filter, forkJoin, of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { ResumeService } from '../../services/resume.service';
import { ReviewService } from '../../services/review.service';
import { SearchService } from '../../services/search.service';
import { ThemeService } from '../../services/theme.service';
import { XpService } from '../../services/xp.service';
import { LANGUAGE_LABELS, Language } from '../../models/language.model';
import { StudyingNowItem, deriveStudyingNow } from '../../shared/studying-now';

/** Same key and values the inline script in index.html reads before first paint. */
const STORAGE_KEY = 'sidebar-collapsed';
/** The badge and "Studying now" list are refreshed at most this often while the reader navigates. */
const REFRESH_MS = 60_000;
/** Below this width the sidebar starts collapsed to icons unless the reader expanded it. */
const NARROW_QUERY = '(max-width: 1199px)';

/**
 * Left navigation rail that replaces the old top header: brand, search, the main links and the
 * account block. Its width is driven by `--mu-sidebar-w` (styles.css), which follows the
 * `data-sidebar` attribute on <html> or the viewport, so the first paint is right before this
 * component runs. Phones hide it; the bottom tab bar takes over there.
 */
@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  protected themeService = inject(ThemeService);
  private languageService = inject(LanguageService);
  private router = inject(Router);
  private searchService = inject(SearchService);
  private reviewService = inject(ReviewService);
  private resumeService = inject(ResumeService);
  private elementRef = inject(ElementRef);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Hint shown in the search trigger; Apple keyboards use ⌘, everything else Ctrl. */
  protected readonly shortcutLabel =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘K'
      : 'Ctrl K';

  protected readonly LANGUAGE_LABELS = LANGUAGE_LABELS;
  protected readonly collapseLabel = $localize`:@@sidebar.collapse:Collapse sidebar`;
  protected readonly expandLabel = $localize`:@@sidebar.expand:Expand sidebar`;

  private preference = signal<boolean | null>(this.readPreference());
  private narrow = signal(this.isBrowser && matchMedia(NARROW_QUERY).matches);
  /** The full-screen daily runner owns the whole viewport, like it does for the bottom nav. */
  protected hidden = signal(this.shouldHide(this.router.url));

  collapsed = computed(() => this.preference() ?? this.narrow());
  /** Reviews due today, shown as a badge on the Review link. */
  dueCount = signal(0);
  studying = signal<StudyingNowItem[]>([]);
  private lastRefresh = 0;

  userMenuOpen = signal(false);
  languageMenuOpen = signal(false);

  /** Fixed for the session: switching language navigates to the other locale's build. */
  protected readonly language = this.languageService.language;
  protected readonly languageCode = this.language === 'pt-BR' ? 'PT' : 'EN';

  userInitials = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return '';
    return user.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  });

  /** Progress inside the current level, 0 to 100. A maxed-out level shows a full bar. */
  levelProgress = computed(() => {
    const summary = this.xpService.summary();
    if (!summary) return 0;
    const { minXp, nextLevelXp } = summary.level;
    if (nextLevelXp === null) return 100;
    return Math.max(0, Math.min(100, ((summary.total - minXp) / (nextLevelXp - minXp)) * 100));
  });

  constructor() {
    if (!this.isBrowser) return;

    matchMedia(NARROW_QUERY).addEventListener('change', (event) => this.narrow.set(event.matches));
    this.applyHidden();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.hidden.set(this.shouldHide(e.urlAfterRedirects));
        this.applyHidden();
        // Answering reviews or reading a concept changes both, so look again when it's stale.
        const stale = Date.now() - this.lastRefresh > REFRESH_MS;
        if (this.auth.currentUser() && (stale || e.urlAfterRedirects.startsWith('/review'))) {
          this.refresh();
        }
      });

    effect(() => {
      if (this.auth.currentUser()) {
        this.refresh();
      } else {
        this.dueCount.set(0);
        this.studying.set([]);
      }
    });
  }

  private refresh(): void {
    this.lastRefresh = Date.now();
    this.reviewService.getDueQueue().subscribe({
      next: (queue) => this.dueCount.set(queue.length),
      error: () => {},
    });
    forkJoin({
      recent: this.reviewService.getRecentActivity().pipe(catchError(() => of([]))),
      resume: this.resumeService.getResumePoint().pipe(catchError(() => of(null))),
    }).subscribe(({ recent, resume }) => this.studying.set(deriveStudyingNow(recent, resume)));
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.preference.set(next);
    document.documentElement.dataset['sidebar'] = next ? 'collapsed' : 'expanded';
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Private mode: the choice just doesn't outlive the tab.
    }
  }

  openSearch(): void {
    this.searchService.open();
  }

  toggleUser(): void {
    if (this.auth.currentUser()) {
      this.languageMenuOpen.set(false);
      this.userMenuOpen.update((open) => !open);
      return;
    }
    void this.router.navigate(['/login']);
  }

  toggleLanguageMenu(): void {
    this.userMenuOpen.set(false);
    this.languageMenuOpen.update((open) => !open);
  }

  setLanguage(lang: Language): void {
    this.languageMenuOpen.set(false);
    this.languageService.setLanguage(lang);
  }

  logout(): void {
    this.userMenuOpen.set(false);
    this.auth.logout();
    void this.router.navigate(['/login']);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.userMenuOpen.set(false);
    this.languageMenuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const inside = (selector: string) =>
      this.elementRef.nativeElement.querySelector(selector)?.contains(event.target as Node);
    if (this.userMenuOpen() && !inside('.user-menu')) this.userMenuOpen.set(false);
    if (this.languageMenuOpen() && !inside('.language-menu')) this.languageMenuOpen.set(false);
  }

  private readPreference(): boolean | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw === '1' ? true : raw === '0' ? false : null;
    } catch {
      return null;
    }
  }

  private shouldHide(url: string): boolean {
    return url.startsWith('/daily/session');
  }

  private applyHidden(): void {
    document.documentElement.toggleAttribute('data-sidebar-hidden', this.hidden());
  }
}
