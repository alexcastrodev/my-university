import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SpringConceptCategory, SpringConceptSummary } from '../../models/spring-concept.model';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { SeoService } from '../../services/seo.service';

const CATEGORY_OPTIONS: { label: string; value: SpringConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Spring Boot', value: 'Spring Boot' },
  { label: 'Spring Security', value: 'Spring Security' },
  { label: 'Spring Batch', value: 'Spring Batch' },
];

@Component({
  selector: 'app-spring-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './spring-concepts-list.html',
  styleUrl: './spring-concepts-list.css',
})
export class SpringConceptsListPage implements OnInit {
  private springConceptsService = inject(SpringConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;

  concepts = signal<SpringConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<SpringConceptCategory | null>(null);
  showOnlyLabs = signal(false);

  filteredConcepts = computed(() => {
    const category = this.selectedCategory();
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();

    return all.filter((c) => {
      const matchesCategory = !category || c.category === category;
      const matchesLab = !showLabs || c.labUrl;
      return matchesCategory && matchesLab;
    });
  });

  onFilterChange(category: SpringConceptCategory | null) {
    this.selectedCategory.set(category);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Spring Concepts',
      description: 'Spring Boot, Spring Security, and Spring Batch concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/spring-concepts',
    });

    this.springConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
