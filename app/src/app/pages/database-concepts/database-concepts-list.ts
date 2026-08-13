import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatabaseConceptCategory, DatabaseConceptSummary } from '../../models/database-concept.model';
import { DatabaseConceptsService } from '../../services/database-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: DatabaseConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'PostgreSQL', value: 'PostgreSQL' },
  { label: 'SQL', value: 'SQL' },
];

@Component({
  selector: 'app-database-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './database-concepts-list.html',
  styleUrl: './database-concepts-list.css',
})
export class DatabaseConceptsListPage implements OnInit {
  private databaseConceptsService = inject(DatabaseConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/databases/database-concepts'];

  concepts = signal<DatabaseConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<DatabaseConceptCategory | null>(null);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const category = this.selectedCategory();
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();

    const filtered = all.filter((c) => {
      const matchesCategory = !category || c.category === category;
      const matchesLab = !showLabs || c.labUrl;
      return matchesCategory && matchesLab;
    });

    return sortByRead(filtered, this.readSort());
  });

  onFilterChange(category: DatabaseConceptCategory | null) {
    this.selectedCategory.set(category);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Database Concepts',
      description: 'PostgreSQL and SQL concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/databases/database-concepts',
    });

    this.databaseConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
