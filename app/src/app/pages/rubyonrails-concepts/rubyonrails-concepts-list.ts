import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RubyOnRailsConceptSummary } from '../../models/rubyonrails-concept.model';
import { RubyOnRailsConceptsService } from '../../services/rubyonrails-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

export interface RubyOnRailsConceptTopicGroup {
  topic: string;
  concepts: RubyOnRailsConceptSummary[];
}

/** Pedagogical order — roughly the order a learner would want to progress through, not alphabetical. */
const TOPIC_ORDER = [
  'Database & ActiveRecord',
  'Application Servers & Infra',
  'Caching',
  'Background Jobs',
  'Front-end & Network',
];

@Component({
  selector: 'app-rubyonrails-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './rubyonrails-concepts-list.html',
  styleUrl: './rubyonrails-concepts-list.css',
})
export class RubyOnRailsConceptsListPage implements OnInit {
  private rubyOnRailsConceptsService = inject(RubyOnRailsConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/rubyonrails-concepts'];

  concepts = signal<RubyOnRailsConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<RubyOnRailsConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, RubyOnRailsConceptSummary[]>();
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
      title: 'Ruby on Rails Concepts',
      description: 'Rails framework and application performance concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/rubyonrails-concepts',
    });

    this.rubyOnRailsConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
