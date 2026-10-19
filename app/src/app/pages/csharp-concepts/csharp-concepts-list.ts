import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CSHARP_CONCEPT_TOPIC_ORDER, CSharpConceptCategory, CSharpConceptSummary } from '../../models/csharp-concept.model';
import { CSharpConceptsService } from '../../services/csharp-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: CSharpConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Language', value: 'Language' },
  { label: 'Type Design', value: 'Type Design' },
  { label: 'Base Class Library', value: 'Base Class Library' },
  { label: 'LINQ', value: 'LINQ' },
  { label: 'Memory & Concurrency', value: 'Memory & Concurrency' },
];

@Component({
  selector: 'app-csharp-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './csharp-concepts-list.html',
  styleUrl: './csharp-concepts-list.css',
})
export class CSharpConceptsListPage implements OnInit {
  private cSharpConceptsService = inject(CSharpConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/csharp-concepts'];

  concepts = signal<CSharpConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<CSharpConceptCategory | null>(null);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const category = this.selectedCategory();
    const showLabs = this.showOnlyLabs();
    return this.concepts().filter(
      (c) => (!category || c.category === category) && (!showLabs || c.labUrl),
    );
  });

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), CSHARP_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

  onFilterChange(category: CSharpConceptCategory | null) {
    this.selectedCategory.set(category);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.seo.set({
      title: 'C# Concepts',
      description: 'C# language and base class library concepts explained in depth: objective, use cases, deep dive, and trade-offs.',
      path: '/csharp-concepts',
    });

    this.cSharpConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
