import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { QUARKUS_CONCEPT_TOPIC_ORDER, QuarkusConceptCategory, QuarkusConceptSummary } from '../../models/quarkus-concept.model';
import { QuarkusConceptsService } from '../../services/quarkus-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: QuarkusConceptCategory | null }[] = [
  { label: 'concepts.filters.all', value: null },
  { label: 'quarkusConcepts.category.coreConfiguration', value: 'Core Configuration' },
  { label: 'quarkusConcepts.category.cachingAuditing', value: 'Caching & Auditing' },
  { label: 'quarkusConcepts.category.multitenancy', value: 'Multitenancy' },
  { label: 'quarkusConcepts.category.customizationMigration', value: 'Customization & Migration' },
  { label: 'quarkusConcepts.category.modernDataAccess', value: 'Modern Data Access' },
  { label: 'quarkusConcepts.category.extensionsTooling', value: 'Extensions & Tooling' },
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

    return all.filter((c) => {
      const matchesCategory = !category || c.category === category;
      const matchesLab = !showLabs || c.labUrl;
      return matchesCategory && matchesLab;
    });
  });

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), QUARKUS_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

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
