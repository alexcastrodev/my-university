import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DotNetConceptCategory, DotNetConceptSummary } from '../../models/dotnet-concept.model';
import { DotNetConceptsService } from '../../services/dotnet-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
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

export interface DotNetConceptTopicGroup {
  topic: string;
  concepts: DotNetConceptSummary[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
const TOPIC_ORDER = [
  // Platform & Tooling
  'Runtime & SDK',
  'Project System',
  'NuGet & Packaging',
  'Publishing & Native AOT',
  // ASP.NET Core
  'ASP.NET Core Fundamentals',
  'Hosting & Pipeline',
  'Minimal APIs',
  'API Documentation',
  'HTTP Clients',
  'Security',
  // Blazor
  'Blazor Fundamentals',
  'Components & Forms',
  // Data Access
  'Data Access Choices',
  'EF Core',
  'EF Core Modeling',
  'EF Core Querying',
  'Migrations',
  // Architecture
  'Application Architecture',
  'Modular Architecture',
  'DDD',
  // Concurrency & Background Work
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
    const filtered = this.concepts().filter(
      (c) => (!category || c.category === category) && (!showLabs || c.labUrl),
    );
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
