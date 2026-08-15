import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { SpringConceptCategory, SpringConceptSummary } from '../../models/spring-concept.model';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: SpringConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Spring Boot', value: 'Spring Boot' },
  { label: 'Spring Security', value: 'Spring Security' },
  { label: 'Spring Batch', value: 'Spring Batch' },
];

export interface SpringConceptTopicGroup {
  topic: string;
  concepts: SpringConceptSummary[];
}

const TOPIC_ORDER = [
  'Core Spring & Boot',
  'Spring MVC & Web',
  'Data Access',
  'Reactive',
  'Messaging',
  'Spring Security',
  'Spring Batch',
];

@Component({
  selector: 'app-spring-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './spring-concepts-list.html',
  styleUrl: './spring-concepts-list.css',
})
export class SpringConceptsListPage implements OnInit {
  private springConceptsService = inject(SpringConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/spring-concepts'];

  concepts = signal<SpringConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<SpringConceptCategory | null>(null);
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

  groupedConcepts = computed<SpringConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, SpringConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

  onFilterChange(category: SpringConceptCategory | null) {
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
