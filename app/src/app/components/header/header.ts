import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { XpService } from '../../services/xp.service';
import { SearchService } from '../../services/search.service';
import { SearchResult, SearchResultType } from '../../models/search.model';
import { Language } from '../../models/language.model';

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

const FILTER_OPTIONS: { label: string; value: SearchResultType | null }[] = [
  { label: 'header.search.filter.all', value: null },
  { label: 'header.search.filter.courses', value: 'course' },
  { label: 'header.search.filter.lessons', value: 'lesson' },
  { label: 'header.search.filter.javaMinute', value: 'java-minute' },
  { label: 'header.search.filter.javaConcepts', value: 'java-concept' },
  { label: 'header.search.filter.jvmConcepts', value: 'jvm-concept' },
  { label: 'header.search.filter.databaseConcepts', value: 'database-concept' },
  { label: 'header.search.filter.springConcepts', value: 'spring-concept' },
  { label: 'header.search.filter.systemDesign', value: 'system-design-concept' },
  { label: 'header.search.filter.testingConcepts', value: 'testing-concept' },
  { label: 'header.search.filter.algorithms', value: 'algorithms-concept' },
  { label: 'header.search.filter.rubyConcepts', value: 'ruby-concept' },
  { label: 'header.search.filter.rubyRailsConcepts', value: 'rubyonrails-concept' },
];

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  protected languageService = inject(LanguageService);
  private router = inject(Router);
  private searchService = inject(SearchService);
  private elementRef = inject(ElementRef);

  protected readonly FILTER_OPTIONS = FILTER_OPTIONS;
  protected readonly LANGUAGE_LABELS = LANGUAGE_LABELS;

  searchQuery = signal('');
  searchResults = signal<SearchResult[]>([]);
  searchLoading = signal(false);
  searchOpen = signal(false);
  searchError = signal(false);
  searchTypeFilter = signal<SearchResultType | null>(null);
  userMenuOpen = signal(false);
  mobileMenuOpen = signal(false);
  mobileSearchOpen = signal(false);
  exploreMenuOpen = signal(false);
  languageMenuOpen = signal(false);

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private exploreCloseTimer: ReturnType<typeof setTimeout> | undefined;

  userInitials = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return $localize`:@@header.signIn:Sign in`;

    return user.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  });

  toggleUser(): void {
    if (this.auth.currentUser()) {
      this.userMenuOpen.update((open) => !open);
      return;
    }
    void this.router.navigate(['/login']);
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
    this.mobileSearchOpen.set(false);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  toggleMobileSearch(): void {
    this.mobileSearchOpen.update((open) => !open);
    this.mobileMenuOpen.set(false);
  }

  closeMobileSearch(): void {
    this.mobileSearchOpen.set(false);
  }

  toggleExploreMenu(): void {
    this.exploreMenuOpen.update((open) => !open);
  }

  closeExploreMenu(): void {
    this.exploreMenuOpen.set(false);
  }

  /** Opens on hover (desktop mega-menu, mirroring Coursera); cancels any pending close from a prior mouseleave. */
  onExploreMouseEnter(): void {
    clearTimeout(this.exploreCloseTimer);
    this.exploreMenuOpen.set(true);
  }

  /** Small delay before closing so moving the cursor from the trigger to the dropdown doesn't close it mid-transit. */
  onExploreMouseLeave(): void {
    clearTimeout(this.exploreCloseTimer);
    this.exploreCloseTimer = setTimeout(() => this.exploreMenuOpen.set(false), 200);
  }

  toggleLanguageMenu(): void {
    this.languageMenuOpen.update((open) => !open);
  }

  closeLanguageMenu(): void {
    this.languageMenuOpen.set(false);
  }

  setLanguage(lang: Language): void {
    this.closeLanguageMenu();
    this.languageService.setLanguage(lang);
  }

  logout(): void {
    this.closeUserMenu();
    this.auth.logout();
    void this.router.navigate(['/login']);
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    clearTimeout(this.debounceTimer);

    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      this.searchResults.set([]);
      this.searchLoading.set(false);
      this.searchOpen.set(trimmed.length > 0);
      return;
    }

    this.searchOpen.set(true);
    this.searchLoading.set(true);
    this.searchError.set(false);
    this.debounceTimer = setTimeout(() => this.runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  }

  onFilterChange(type: SearchResultType | null): void {
    this.searchTypeFilter.set(type);
    const trimmed = this.searchQuery().trim();
    if (trimmed.length >= MIN_QUERY_LENGTH) {
      this.searchLoading.set(true);
      this.searchError.set(false);
      this.runSearch(trimmed);
    }
  }

  private runSearch(query: string): void {
    this.searchService.search(query, this.searchTypeFilter() ?? undefined).subscribe({
      next: (results) => {
        if (this.searchQuery().trim() === query) {
          this.searchResults.set(results);
        }
        this.searchLoading.set(false);
      },
      error: () => {
        this.searchLoading.set(false);
        this.searchError.set(true);
      },
    });
  }

  selectResult(): void {
    this.closeSearch();
  }

  onSearchFocus(): void {
    if (this.searchQuery().trim().length > 0) {
      this.searchOpen.set(true);
    }
  }

  closeSearch(): void {
    this.searchOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeSearch();
    this.closeUserMenu();
    this.closeMobileMenu();
    this.closeExploreMenu();
    this.closeLanguageMenu();
    this.closeMobileSearch();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.searchOpen()) {
      const searchBox = this.elementRef.nativeElement.querySelector('.search-box');
      if (searchBox && !searchBox.contains(event.target as Node)) {
        this.closeSearch();
      }
    }

    if (this.userMenuOpen()) {
      const userMenu = this.elementRef.nativeElement.querySelector('.user-menu');
      if (userMenu && !userMenu.contains(event.target as Node)) {
        this.closeUserMenu();
      }
    }

    if (this.mobileMenuOpen()) {
      const nav = this.elementRef.nativeElement.querySelector('.nav-links');
      const toggle = this.elementRef.nativeElement.querySelector('.mobile-menu-toggle');
      const target = event.target as Node;
      if (nav && toggle && !nav.contains(target) && !toggle.contains(target)) {
        this.closeMobileMenu();
      }
    }

    if (this.exploreMenuOpen()) {
      const exploreMenu = this.elementRef.nativeElement.querySelector('.explore-menu');
      if (exploreMenu && !exploreMenu.contains(event.target as Node)) {
        this.closeExploreMenu();
      }
    }

    if (this.languageMenuOpen()) {
      const languageMenu = this.elementRef.nativeElement.querySelector('.language-menu');
      if (languageMenu && !languageMenu.contains(event.target as Node)) {
        this.closeLanguageMenu();
      }
    }

    if (this.mobileSearchOpen()) {
      const mobileSearch = this.elementRef.nativeElement.querySelector('.mobile-search-row');
      const toggle = this.elementRef.nativeElement.querySelector('.mobile-search-toggle');
      const target = event.target as Node;
      if (mobileSearch && toggle && !mobileSearch.contains(target) && !toggle.contains(target)) {
        this.closeMobileSearch();
      }
    }
  }
}
