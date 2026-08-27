import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AlgorithmsConceptCategory, AlgorithmsConceptSummary } from '../../models/algorithms-concept.model';
import { AlgorithmsConceptsService } from '../../services/algorithms-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';
import { TranslationKey } from '../../shared/i18n/translations';

const CATEGORY_OPTIONS: { label: TranslationKey; value: AlgorithmsConceptCategory | null }[] = [
  { label: 'concepts.filters.all', value: null },
  { label: 'algorithmsConcepts.category.fundamentals', value: 'Fundamentals' },
  { label: 'algorithmsConcepts.category.sorting', value: 'Sorting' },
  { label: 'algorithmsConcepts.category.dataStructures', value: 'Data Structures' },
  { label: 'algorithmsConcepts.category.graphs', value: 'Graphs' },
  { label: 'algorithmsConcepts.category.strings', value: 'Strings' },
  { label: 'algorithmsConcepts.category.dynamicProgrammingGreedy', value: 'Dynamic Programming & Greedy' },
];

@Component({
  selector: 'app-algorithms-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent, TranslatePipe],
  templateUrl: './algorithms-concepts-list.html',
  styleUrl: './algorithms-concepts-list.css',
})
export class AlgorithmsConceptsListPage implements OnInit {
  private algorithmsConceptsService = inject(AlgorithmsConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/algorithms/algorithms-concepts'];

  concepts = signal<AlgorithmsConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<AlgorithmsConceptCategory | null>(null);
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

  onFilterChange(category: AlgorithmsConceptCategory | null) {
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
      title: 'Algorithms',
      description: 'Classic algorithms and data structures explained in depth, from Sedgewick and Cormen — objective, use cases, deep dive, and trade-offs.',
      path: '/algorithms/algorithms-concepts',
    });

    this.algorithmsConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
