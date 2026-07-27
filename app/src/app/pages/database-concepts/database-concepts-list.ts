import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatabaseConceptCategory, DatabaseConceptSummary } from '../../models/database-concept.model';
import { DatabaseConceptsService } from '../../services/database-concepts.service';
import { SeoService } from '../../services/seo.service';

const CATEGORY_OPTIONS: { label: string; value: DatabaseConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'PostgreSQL', value: 'PostgreSQL' },
];

@Component({
  selector: 'app-database-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './database-concepts-list.html',
  styleUrl: './database-concepts-list.css',
})
export class DatabaseConceptsListPage implements OnInit {
  private databaseConceptsService = inject(DatabaseConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;

  concepts = signal<DatabaseConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<DatabaseConceptCategory | null>(null);

  filteredConcepts = computed(() => {
    const category = this.selectedCategory();
    const all = this.concepts();
    return category ? all.filter((c) => c.category === category) : all;
  });

  onFilterChange(category: DatabaseConceptCategory | null) {
    this.selectedCategory.set(category);
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
