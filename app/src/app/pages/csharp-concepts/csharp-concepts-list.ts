import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CSharpConceptSummary } from '../../models/csharp-concept.model';
import { CSharpConceptsService } from '../../services/csharp-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

export interface CSharpConceptTopicGroup {
  topic: string;
  concepts: CSharpConceptSummary[];
}

/** Pedagogical order: roughly the order a learner would want to progress through, not alphabetical. */
const TOPIC_ORDER = [
  'Collections',
  'Streams',
  'Threads',
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

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/csharp-concepts'];

  concepts = signal<CSharpConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<CSharpConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, CSharpConceptSummary[]>();
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
