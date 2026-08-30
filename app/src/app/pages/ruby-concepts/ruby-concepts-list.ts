import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RubyConceptSummary } from '../../models/ruby-concept.model';
import { RubyConceptsService } from '../../services/ruby-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

export interface RubyConceptTopicGroup {
  topic: string;
  concepts: RubyConceptSummary[];
}

/** Pedagogical order — roughly the order a learner would want to progress through, not alphabetical. */
const TOPIC_ORDER = [
  'Object Model & Metaprogramming',
  'Concurrency',
  'Collections & Blocks',
  'Language Core & Idioms',
  'Performance & Internals',
];

@Component({
  selector: 'app-ruby-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './ruby-concepts-list.html',
  styleUrl: './ruby-concepts-list.css',
})
export class RubyConceptsListPage implements OnInit {
  private rubyConceptsService = inject(RubyConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/ruby-concepts'];

  concepts = signal<RubyConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<RubyConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, RubyConceptSummary[]>();
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
      title: 'Ruby Concepts',
      description: 'Core Ruby language concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/ruby-concepts',
    });

    this.rubyConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
