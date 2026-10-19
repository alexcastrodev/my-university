import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DOTNET_TESTING_CONCEPT_TOPIC_ORDER, DotNetTestingConceptSummary } from '../../models/dotnet-testing-concept.model';
import { DotNetTestingConceptsService } from '../../services/dotnet-testing-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { ConceptTopicGroup, groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-dotnet-testing-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './dotnet-testing-concepts-list.html',
  styleUrl: './dotnet-testing-concepts-list.css',
})
export class DotNetTestingConceptsListPage implements OnInit {
  private dotNetTestingConceptsService = inject(DotNetTestingConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/dotnet-testing-concepts'];

  concepts = signal<DotNetTestingConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  groupedConcepts = computed<ConceptTopicGroup<DotNetTestingConceptSummary>[]>(() =>
    groupByTopic(this.filteredConcepts(), DOTNET_TESTING_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.seo.set({
      title: '.NET Testing Concepts',
      description: 'Testing .NET code with MSTest explained in depth: objective, use cases, deep dive, and trade-offs.',
      path: '/dotnet-testing-concepts',
    });

    this.dotNetTestingConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
