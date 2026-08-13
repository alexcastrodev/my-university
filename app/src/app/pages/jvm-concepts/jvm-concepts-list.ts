import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { JvmConceptSummary } from '../../models/jvm-concept.model';
import { JvmConceptsService } from '../../services/jvm-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-jvm-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './jvm-concepts-list.html',
  styleUrl: './jvm-concepts-list.css',
})
export class JvmConceptsListPage implements OnInit {
  private jvmConceptsService = inject(JvmConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/java/jvm-concepts'];

  concepts = signal<JvmConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.seo.set({
      title: 'JVM Concepts',
      description: 'How the JVM works under the hood, explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/java/jvm-concepts',
    });

    this.jvmConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
