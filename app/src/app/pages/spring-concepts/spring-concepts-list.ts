import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SpringConceptCategory, SpringConceptSummary } from '../../models/spring-concept.model';
import { Language } from '../../models/language.model';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';

const CATEGORY_OPTIONS: { label: string; value: SpringConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Spring Boot', value: 'Spring Boot' },
  { label: 'Spring Security', value: 'Spring Security' },
  { label: 'Spring Batch', value: 'Spring Batch' },
];

export interface SpringConceptTopicGroup {
  topic: string;
  concepts: SpringConceptSummary[];
}

const TOPIC_ORDER = [
  'Core Spring & Boot',
  'Spring MVC & Web',
  'Data Access',
  'Reactive',
  'Messaging',
  'Spring Security',
  'Spring Batch',
];

const EN_PATH = '/spring-concepts';
const PT_BR_PATH = '/pt-BR/spring-concepts';

@Component({
  selector: 'app-spring-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent, TranslatePipe],
  templateUrl: './spring-concepts-list.html',
  styleUrl: './spring-concepts-list.css',
})
export class SpringConceptsListPage implements OnInit {
  private route = inject(ActivatedRoute);
  private springConceptsService = inject(SpringConceptsService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;

  /** Set when this route is the locale-prefixed variant (/pt-BR/spring-concepts) — the URL, not localStorage, decides the language for this page. */
  private readonly urlLocale = this.route.snapshot.data['locale'] as Language | undefined;
  protected readonly basePath = this.urlLocale === 'pt-BR' ? PT_BR_PATH : EN_PATH;
  protected readonly ROUTE_COMMANDS = [this.basePath];

  concepts = signal<SpringConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<SpringConceptCategory | null>(null);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const category = this.selectedCategory();
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();

    const filtered = all.filter((c) => {
      const matchesCategory = !category || c.category === category;
      const matchesLab = !showLabs || c.labUrl;
      return matchesCategory && matchesLab;
    });

    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<SpringConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, SpringConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

  constructor() {
    if (this.urlLocale) this.languageService.setLanguageFromUrl(this.urlLocale);

    effect(() => {
      this.languageService.language();
      this.loading.set(true);
      this.springConceptsService.listConcepts().subscribe({
        next: (list) => { this.concepts.set(list); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    });
  }

  onFilterChange(category: SpringConceptCategory | null) {
    this.selectedCategory.set(category);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  ngOnInit() {
    const isPtBr = this.urlLocale === 'pt-BR';
    this.seo.set({
      title: 'Spring Concepts',
      description: isPtBr
        ? 'Conceitos de Spring Boot, Spring Security e Spring Batch explicados a fundo — objetivo, casos de uso, deep dive e trade-offs.'
        : 'Spring Boot, Spring Security, and Spring Batch concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: this.basePath,
      language: isPtBr ? 'pt-BR' : 'en',
      alternates: [
        { lang: 'en', path: EN_PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
