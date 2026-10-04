import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { LanguageService } from '../../services/language.service';
import { SearchService } from '../../services/search.service';
import {
  HighlightSegment,
  SearchResult,
  SearchResultType,
  toHighlightSegments,
} from '../../models/search.model';
import type { CurriculumModule } from '../../pages/computer-science/curriculum.data';

const SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;
const PAGE_SIZE = 20;

/** Pill label per type, in the order pills appear when counts tie. */
const TYPE_LABELS: Record<SearchResultType, string> = {
  'curriculum-concept': $localize`:@@search.type.curriculumConcept:Computer Science`,
  'java-concept': $localize`:@@search.type.javaConcept:Java Concepts`,
  'jvm-concept': $localize`:@@search.type.jvmConcept:JVM Concepts`,
  'java-minute': $localize`:@@search.type.javaMinute:Java Minute`,
  'testing-concept': $localize`:@@search.type.testingConcept:Testing`,
  'spring-concept': $localize`:@@search.type.springConcept:Spring`,
  'quarkus-concept': $localize`:@@search.type.quarkusConcept:Quarkus`,
  'database-concept': $localize`:@@search.type.databaseConcept:Databases`,
  'system-design-concept': $localize`:@@search.type.systemDesignConcept:System Design`,
  'algorithms-concept': $localize`:@@search.type.algorithmsConcept:Algorithms`,
  'kubernetes-concept': $localize`:@@search.type.kubernetesConcept:Kubernetes`,
  'ruby-concept': $localize`:@@search.type.rubyConcept:Ruby`,
  'rubyonrails-concept': $localize`:@@search.type.rubyonrailsConcept:Ruby on Rails`,
  'dotnet-concept': $localize`:@@search.type.dotnetConcept:.NET`,
  course: $localize`:@@search.type.course:Exams`,
  lesson: $localize`:@@search.type.lesson:Lessons`,
};

const TYPE_ORDER = Object.keys(TYPE_LABELS) as SearchResultType[];

interface ResultView {
  result: SearchResult;
  subtitle: string | null;
  title: HighlightSegment[];
  snippet: HighlightSegment[] | null;
  /** Shown when the page has no version in the reader's language yet. */
  otherLanguage: string | null;
}

interface FilterPill {
  type: SearchResultType | null;
  label: string;
  count: number;
}

/**
 * Platform-wide search, opened from the header or with Ctrl/Cmd+K or "/". It replaces the old
 * header dropdown, which only fit a handful of results: with well over a thousand pages, finding
 * one needs per-track counts to narrow by, an excerpt showing why a result matched, paging past
 * the first results, and a keyboard-only path.
 */
@Component({
  selector: 'app-search-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './search-palette.html',
  styleUrl: './search-palette.css',
})
export class SearchPalette {
  protected search = inject(SearchService);
  private languageService = inject(LanguageService);
  private router = inject(Router);
  private document = inject(DOCUMENT);

  private input = viewChild<ElementRef<HTMLInputElement>>('input');
  private list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly MIN_QUERY_LENGTH = MIN_QUERY_LENGTH;

  query = signal('');
  type = signal<SearchResultType | null>(null);
  results = signal<SearchResult[]>([]);
  total = signal(0);
  facets = signal<Partial<Record<SearchResultType, number>>>({});
  loading = signal(false);
  loadingMore = signal(false);
  error = signal(false);
  activeIndex = signal(0);
  /** The query the shown results belong to (results stay visible while the next query loads). */
  settledQuery = signal('');
  /** Discipline slug -> localized title, from the curriculum registry (loaded on first open, it's large). */
  private disciplineTitles = signal<Map<string, string>>(new Map());

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private request: Subscription | undefined;
  private previousFocus: Element | null = null;

  trimmed = computed(() => this.query().trim());

  views = computed<ResultView[]>(() => {
    const language = this.languageService.language;
    const disciplines = this.disciplineTitles();
    return this.results().map((result) => ({
      result,
      subtitle: this.subtitleFor(result, disciplines),
      title: toHighlightSegments(result.highlightedTitle || result.title),
      snippet: result.snippet ? toHighlightSegments(result.snippet) : null,
      otherLanguage: result.language !== language ? result.language.toUpperCase() : null,
    }));
  });

  pills = computed<FilterPill[]>(() => {
    const facets = this.facets();
    const active = this.type();
    const all = TYPE_ORDER.reduce((sum, type) => sum + (facets[type] ?? 0), 0);
    const byType = TYPE_ORDER.filter((type) => (facets[type] ?? 0) > 0 || type === active)
      .map((type) => ({ type, label: TYPE_LABELS[type], count: facets[type] ?? 0 }))
      .sort((a, b) => b.count - a.count);
    return [{ type: null, label: $localize`:@@search.filter.all:All`, count: all }, ...byType];
  });

  hasMore = computed(() => this.results().length < this.total());

  constructor() {
    effect(() => {
      if (this.search.paletteOpen()) this.onOpened();
      else this.onClosed();
    });
  }

  typeLabel(type: SearchResultType): string {
    return TYPE_LABELS[type];
  }

  /**
   * The API only knows a curriculum discipline by its slug, so its subtitle is a title-cased slug
   * ("Data Structures Ii"); the registry has the real, translated name. Concept tracks' subtitles
   * only repeat the (already translated) type label in English, so they're dropped; lessons keep
   * theirs, the course they belong to.
   */
  private subtitleFor(result: SearchResult, disciplines: Map<string, string>): string | null {
    if (result.type === 'curriculum-concept') {
      const slug = result.url.split('/')[3];
      return disciplines.get(slug) ?? result.subtitle;
    }
    return result.type === 'lesson' || result.type === 'course' ? result.subtitle : null;
  }

  private loadDisciplineTitles(): void {
    if (this.disciplineTitles().size) return;
    void import('../../pages/computer-science/curriculum.data').then(({ CURRICULUM }) => {
      const titles = new Map<string, string>();
      const walk = (modules: CurriculumModule[]) => {
        for (const module of modules) {
          for (const discipline of module.disciplines ?? [])
            titles.set(discipline.slug, discipline.title);
          walk(module.tracks ?? []);
        }
      };
      walk(CURRICULUM);
      this.disciplineTitles.set(titles);
    });
  }

  private onOpened(): void {
    this.previousFocus = this.document.activeElement;
    this.loadDisciplineTitles();
    this.document.body.classList.add('search-palette-open');
    // The input only exists once the open state has rendered.
    setTimeout(() => {
      const el = this.input()?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  private onClosed(): void {
    this.document.body.classList.remove('search-palette-open');
    clearTimeout(this.debounceTimer);
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
    this.previousFocus = null;
  }

  close(): void {
    this.search.close();
  }

  onInput(value: string): void {
    this.query.set(value);
    clearTimeout(this.debounceTimer);
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      this.request?.unsubscribe();
      this.results.set([]);
      this.total.set(0);
      this.facets.set({});
      this.settledQuery.set('');
      this.loading.set(false);
      this.error.set(false);
      return;
    }
    this.loading.set(true);
    this.debounceTimer = setTimeout(() => this.run(trimmed), SEARCH_DEBOUNCE_MS);
  }

  setType(type: SearchResultType | null): void {
    if (this.type() === type) return;
    this.type.set(type);
    const trimmed = this.trimmed();
    if (trimmed.length >= MIN_QUERY_LENGTH) {
      this.loading.set(true);
      this.run(trimmed);
    }
    this.input()?.nativeElement.focus();
  }

  useRecent(query: string): void {
    this.onInput(query);
    clearTimeout(this.debounceTimer);
    this.run(query);
    this.input()?.nativeElement.focus();
  }

  loadMore(): void {
    const query = this.settledQuery();
    if (!query || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.request?.unsubscribe();
    this.request = this.search
      .search(query, { type: this.type(), offset: this.results().length, limit: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.results.update((current) => [...current, ...res.results]);
          this.total.set(res.total);
          this.loadingMore.set(false);
        },
        error: () => {
          this.loadingMore.set(false);
          this.error.set(true);
        },
      });
  }

  private run(query: string): void {
    this.request?.unsubscribe();
    this.error.set(false);
    this.request = this.search.search(query, { type: this.type(), limit: PAGE_SIZE }).subscribe({
      next: (res) => {
        this.results.set(res.results);
        this.total.set(res.total);
        this.facets.set(res.facets);
        this.settledQuery.set(query);
        this.activeIndex.set(0);
        this.loading.set(false);
        this.list()?.nativeElement.scrollTo({ top: 0 });
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }

  open(result: SearchResult): void {
    this.search.remember(this.settledQuery() || this.trimmed());
    this.close();
    void this.router.navigateByUrl(result.url);
  }

  /** A click is navigated by the result's routerLink (which also handles new-tab clicks); this only records and closes. */
  onResultClick(event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    this.search.remember(this.settledQuery() || this.trimmed());
    this.close();
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        if (!count) return;
        event.preventDefault();
        this.moveActive(Math.min(count - 1, this.activeIndex() + 1));
        break;
      case 'ArrowUp':
        if (!count) return;
        event.preventDefault();
        this.moveActive(Math.max(0, this.activeIndex() - 1));
        break;
      case 'Enter': {
        const result = this.results()[this.activeIndex()];
        if (result) {
          event.preventDefault();
          this.open(result);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
    }
  }

  private moveActive(index: number): void {
    this.activeIndex.set(index);
    const option = this.document.getElementById(this.optionId(index));
    option?.scrollIntoView({ block: 'nearest' });
  }

  optionId(index: number): string {
    return `search-palette-option-${index}`;
  }

  /** Ctrl/Cmd+K anywhere toggles; "/" opens unless the user is typing somewhere. */
  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.search.toggle();
      return;
    }
    if (event.key === '/' && !this.search.paletteOpen() && !isTypingTarget(event.target)) {
      event.preventDefault();
      this.search.open();
    }
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
