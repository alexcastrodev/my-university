import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DotNetConceptSummary } from '../../models/dotnet-concept.model';
import { DotNetConceptsService } from '../../services/dotnet-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

export interface DotNetConceptTopicGroup {
  topic: string;
  concepts: DotNetConceptSummary[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
const TOPIC_ORDER = [
  'ASP.NET Core Fundamentals',
  'Application Architecture',
  'Modular Architecture',
  'DDD',
  'EF Core',
  'Migrations',
  'Background Jobs',
  'Concurrency',
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

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/dotnet-concepts'];

  concepts = signal<DotNetConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<DotNetConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, DotNetConceptSummary[]>();
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
