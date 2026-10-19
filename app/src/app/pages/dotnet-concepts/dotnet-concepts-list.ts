import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DOTNET_CONCEPT_TOPIC_ORDER, DotNetConceptCategory, DotNetConceptSummary } from '../../models/dotnet-concept.model';
import { DotNetConceptsService } from '../../services/dotnet-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: DotNetConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Platform & Tooling', value: 'Platform & Tooling' },
  { label: 'ASP.NET Core', value: 'ASP.NET Core' },
  { label: 'Blazor', value: 'Blazor' },
  { label: 'Data Access', value: 'Data Access' },
  { label: 'Architecture', value: 'Architecture' },
  { label: 'Concurrency & Background Work', value: 'Concurrency & Background Work' },
];

@Component({
  selector: 'app-dotnet-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './dotnet-concepts-list.html',
  styleUrl: './dotnet-concepts-list.css',
})
export class DotNetConceptsListPage implements OnInit {
  private dotNetConceptsService = inject(DotNetConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/dotnet-concepts'];

  concepts = signal<DotNetConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<DotNetConceptCategory | null>(null);
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
    groupByTopic(this.filteredConcepts(), DOTNET_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

  onFilterChange(category: DotNetConceptCategory | null) {
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
      title: '.NET Concepts',
      description: '.NET platform and application architecture concepts explained in depth: objective, use cases, deep dive, and trade-offs.',
      path: '/dotnet-concepts',
    });

    this.dotNetConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
