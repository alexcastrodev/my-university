import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RUBYONRAILS_CONCEPT_TOPIC_ORDER, RubyOnRailsConceptSummary } from '../../models/rubyonrails-concept.model';
import { RubyOnRailsConceptsService } from '../../services/rubyonrails-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { ConceptTopicGroup, groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

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
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  groupedConcepts = computed<ConceptTopicGroup<RubyOnRailsConceptSummary>[]>(() =>
    groupByTopic(this.filteredConcepts(), RUBYONRAILS_CONCEPT_TOPIC_ORDER).map((group) => ({
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
