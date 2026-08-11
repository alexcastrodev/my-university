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
import { XpService } from '../../services/xp.service';
import { SearchService } from '../../services/search.service';
import { SearchResult, SearchResultType } from '../../models/search.model';

const TYPE_LABELS: Record<SearchResultType, string> = {
  course: 'Course',
  lesson: 'Lesson',
  'java-minute': 'Java Minute',
  'java-concept': 'Java Concept',
  'jvm-concept': 'JVM Concept',
  'database-concept': 'Database Concept',
  'spring-concept': 'Spring Concept',
  'system-design-concept': 'System Design',
  'testing-concept': 'Testing Concept',
};

const FILTER_OPTIONS: { label: string; value: SearchResultType | null }[] = [
  { label: 'All', value: null },
  { label: 'Courses', value: 'course' },
  { label: 'Lessons', value: 'lesson' },
  { label: 'Java Minute', value: 'java-minute' },
  { label: 'Java Concepts', value: 'java-concept' },
  { label: 'JVM Concepts', value: 'jvm-concept' },
  { label: 'Database Concepts', value: 'database-concept' },
  { label: 'Spring Concepts', value: 'spring-concept' },
  { label: 'System Design', value: 'system-design-concept' },
  { label: 'Testing Concepts', value: 'testing-concept' },
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
  private router = inject(Router);
  private searchService = inject(SearchService);
  private elementRef = inject(ElementRef);

  protected readonly TYPE_LABELS = TYPE_LABELS;
  protected readonly FILTER_OPTIONS = FILTER_OPTIONS;

  searchQuery = signal('');
  searchResults = signal<SearchResult[]>([]);
  searchLoading = signal(false);
  searchOpen = signal(false);
  searchError = signal(false);
  searchTypeFilter = signal<SearchResultType | null>(null);
  userMenuOpen = signal(false);
  mobileMenuOpen = signal(false);
  javaMenuOpen = signal(false);

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  userInitials = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return 'Sign in';

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
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  toggleJavaMenu(): void {
    this.javaMenuOpen.update((open) => !open);
  }

  closeJavaMenu(): void {
    this.javaMenuOpen.set(false);
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
    this.closeJavaMenu();
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

    if (this.javaMenuOpen()) {
      const javaMenu = this.elementRef.nativeElement.querySelector('.java-menu');
      if (javaMenu && !javaMenu.contains(event.target as Node)) {
        this.closeJavaMenu();
      }
    }
  }
}
