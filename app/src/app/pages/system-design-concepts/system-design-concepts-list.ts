import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SystemDesignConceptSummary } from '../../models/system-design-concept.model';
import { Language } from '../../models/language.model';
import { SystemDesignConceptsService } from '../../services/system-design-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

export interface SystemDesignConceptTopicGroup {
  topic: string;
  concepts: SystemDesignConceptSummary[];
}

const EN_PATH = '/system-design/system-design-concepts';
const PT_BR_PATH = '/pt-BR/system-design/system-design-concepts';

const TOPIC_ORDER = [
  'Distributed Systems Fundamentals',
  'Resilience & Operability',
  'Security in Distributed Systems',
  'Data Storage & Modeling',
  'Replication & Consistency',
  'Scaling & Infrastructure',
  'Messaging & Streaming',
  'Observability & SRE',
  'System Design Case Studies',
];

@Component({
  selector: 'app-system-design-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './system-design-concepts-list.html',
  styleUrl: './system-design-concepts-list.css',
})
export class SystemDesignConceptsListPage implements OnInit {
  private static readonly VISIBLE_TAG_LIMIT = 10;

  private route = inject(ActivatedRoute);
  private systemDesignConceptsService = inject(SystemDesignConceptsService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;

  /** Set when this route is the locale-prefixed variant (/pt-BR/system-design/system-design-concepts) — the URL, not localStorage, decides the language for this page. */
  private readonly urlLocale = this.route.snapshot.data['locale'] as Language | undefined;
  protected readonly basePath = this.urlLocale === 'pt-BR' ? PT_BR_PATH : EN_PATH;
  protected readonly ROUTE_COMMANDS = [this.basePath];

  concepts = signal<SystemDesignConceptSummary[]>([]);
  loading = signal(true);
  selectedTag = signal<string | null>(null);
  showAllTags = signal(false);
  readSort = signal<ReadSortOrder>('default');

  /** Tags ranked by how many concepts use them (most common first, alphabetical tiebreak). */
  rankedTagOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const concept of this.concepts()) {
      for (const tag of concept.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB))
      .map(([tag]) => ({ label: tag, value: tag as string | null }));
  });

  visibleTagOptions = computed(() => {
    const ranked = this.rankedTagOptions();
    return this.showAllTags() ? ranked : ranked.slice(0, SystemDesignConceptsListPage.VISIBLE_TAG_LIMIT);
  });

  hasMoreTags = computed(() => this.rankedTagOptions().length > SystemDesignConceptsListPage.VISIBLE_TAG_LIMIT);

  hiddenTagCount = computed(() => this.rankedTagOptions().length - SystemDesignConceptsListPage.VISIBLE_TAG_LIMIT);

  showOnlyLabs = signal(false);

  filteredConcepts = computed(() => {
    const tag = this.selectedTag();
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();

    const filtered = all.filter((c) => {
      const matchesTag = !tag || c.tags.includes(tag);
      const matchesLab = !showLabs || c.labUrl;
      return matchesTag && matchesLab;
    });

    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<SystemDesignConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, SystemDesignConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

  onFilterChange(tag: string | null) {
    this.selectedTag.set(tag);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  onToggleShowAllTags() {
    this.showAllTags.update((v) => !v);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  constructor() {
    if (this.urlLocale) this.languageService.setLanguageFromUrl(this.urlLocale);

    effect(() => {
      this.languageService.language();
      this.loading.set(true);
      this.systemDesignConceptsService.listConcepts().subscribe({
        next: (list) => { this.concepts.set(list); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    });
  }

  ngOnInit() {
    const isPtBr = this.urlLocale === 'pt-BR';
    this.seo.set({
      title: 'System Design Concepts',
      description: isPtBr
        ? 'Conceitos de sistemas distribuídos e arquitetura explicados a fundo — visão geral, arquitetura, garantias, trade-offs e perguntas de entrevista.'
        : 'Distributed systems and architecture concepts explained in depth — overview, architecture, guarantees, trade-offs, and interview questions.',
      path: this.basePath,
      language: isPtBr ? 'pt-BR' : 'en',
      alternates: [
        { lang: 'en', path: EN_PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
