import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TestingConceptCategory, TestingConceptSummary } from '../../models/testing-concept.model';
import { TestingConceptsService } from '../../services/testing-concepts.service';
import { SeoService } from '../../services/seo.service';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: TestingConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Java', value: 'Java' },
  { label: 'Spring', value: 'Spring' },
];

@Component({
  selector: 'app-testing-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './testing-concepts-list.html',
  styleUrl: './testing-concepts-list.css',
})
export class TestingConceptsListPage implements OnInit {
  private testingConceptsService = inject(TestingConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;

  concepts = signal<TestingConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<TestingConceptCategory | null>(null);
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

  onFilterChange(category: TestingConceptCategory | null) {
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
      title: 'Testing Concepts',
      description: 'JUnit 5, Mockito, and Spring testing concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/java/testing',
    });

    this.testingConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
