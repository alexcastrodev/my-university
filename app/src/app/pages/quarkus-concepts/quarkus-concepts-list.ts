import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { QuarkusConceptCategory, QuarkusConceptSummary } from '../../models/quarkus-concept.model';
import { QuarkusConceptsService } from '../../services/quarkus-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';
import { TranslationKey } from '../../shared/i18n/translations';

const CATEGORY_OPTIONS: { label: TranslationKey; value: QuarkusConceptCategory | null }[] = [
  { label: 'concepts.filters.all', value: null },
  { label: 'quarkusConcepts.category.coreConfiguration', value: 'Core Configuration' },
  { label: 'quarkusConcepts.category.cachingAuditing', value: 'Caching & Auditing' },
  { label: 'quarkusConcepts.category.multitenancy', value: 'Multitenancy' },
  { label: 'quarkusConcepts.category.customizationMigration', value: 'Customization & Migration' },
  { label: 'quarkusConcepts.category.modernDataAccess', value: 'Modern Data Access' },
  { label: 'quarkusConcepts.category.extensionsTooling', value: 'Extensions & Tooling' },
];

export interface QuarkusConceptTopicGroup {
  topic: string;
  concepts: QuarkusConceptSummary[];
}

const TOPIC_ORDER = [
  'Core Configuration',
  'Caching & Auditing',
  'Multitenancy',
  'Customization & Migration',
  'Modern Data Access',
  'Extensions & Tooling',
];

@Component({
  selector: 'app-quarkus-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './quarkus-concepts-list.html',
  styleUrl: './quarkus-concepts-list.css',
})
export class QuarkusConceptsListPage implements OnInit {
  private quarkusConceptsService = inject(QuarkusConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/quarkus-concepts'];

  concepts = signal<QuarkusConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<QuarkusConceptCategory | null>(null);
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

  groupedConcepts = computed<QuarkusConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, QuarkusConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

  onFilterChange(category: QuarkusConceptCategory | null) {
    this.selectedCategory.set(category);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Quarkus Concepts',
      description: 'Hibernate ORM and Jakarta Persistence in Quarkus — configuration, caching, multitenancy, and modern data access explained in depth.',
      path: '/quarkus-concepts',
    });

    this.quarkusConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
