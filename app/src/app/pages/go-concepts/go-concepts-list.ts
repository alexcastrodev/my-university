import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { GO_CONCEPT_TOPIC_ORDER, GoConceptSummary } from '../../models/go-concept.model';
import { GoConceptsService } from '../../services/go-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-go-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './go-concepts-list.html',
  styleUrl: './go-concepts-list.css',
})
export class GoConceptsListPage implements OnInit {
  private goConceptsService = inject(GoConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/go-concepts'];

  concepts = signal<GoConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), GO_CONCEPT_TOPIC_ORDER).map((group) => ({
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
      title: 'Go Concepts',
      description: 'Advanced Go explained in depth: objective, use cases, deep dive, and trade-offs.',
      path: '/go-concepts',
    });

    this.goConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
