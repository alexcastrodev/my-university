import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { IDENTITY_CONCEPT_TOPIC_ORDER, IdentityConceptSummary } from '../../models/identity-concept.model';
import { IdentityConceptsService } from '../../services/identity-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-identity-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './identity-concepts-list.html',
  styleUrl: './identity-concepts-list.css',
})
export class IdentityConceptsListPage implements OnInit {
  private identityConceptsService = inject(IdentityConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/identity-concepts'];

  concepts = signal<IdentityConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), IDENTITY_CONCEPT_TOPIC_ORDER).map((group) => ({
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
      title: 'Identity & Access Concepts',
      description: 'Identity and access management explained in depth, protocol by protocol: objective, use cases, deep dive, and trade-offs.',
      path: '/identity-concepts',
    });

    this.identityConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
