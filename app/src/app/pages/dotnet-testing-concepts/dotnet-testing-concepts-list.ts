import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DotNetTestingConceptSummary } from '../../models/dotnet-testing-concept.model';
import { DotNetTestingConceptsService } from '../../services/dotnet-testing-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

export interface DotNetTestingConceptTopicGroup {
  topic: string;
  concepts: DotNetTestingConceptSummary[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
const TOPIC_ORDER = [
  'Domain Layer',
];

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
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<DotNetTestingConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, DotNetTestingConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

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
