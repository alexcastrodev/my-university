import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RUST_CONCEPT_TOPIC_ORDER, RustConceptSummary } from '../../models/rust-concept.model';
import { RustConceptsService } from '../../services/rust-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-rust-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './rust-concepts-list.html',
  styleUrl: './rust-concepts-list.css',
})
export class RustConceptsListPage implements OnInit {
  private rustConceptsService = inject(RustConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/rust-concepts'];

  concepts = signal<RustConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), RUST_CONCEPT_TOPIC_ORDER).map((group) => ({
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
      title: 'Rust Concepts',
      description: 'Advanced Rust explained in depth: objective, use cases, deep dive, and trade-offs.',
      path: '/rust-concepts',
    });

    this.rustConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
