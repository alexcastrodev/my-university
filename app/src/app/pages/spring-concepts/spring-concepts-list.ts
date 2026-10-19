import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { SPRING_CONCEPT_TOPIC_ORDER, SpringConceptCategory, SpringConceptSummary } from '../../models/spring-concept.model';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: SpringConceptCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Spring Boot', value: 'Spring Boot' },
  { label: 'Spring Security', value: 'Spring Security' },
  { label: 'Spring Batch', value: 'Spring Batch' },
];

const PATH = '/spring-concepts';
const PT_BR_PATH = '/pt-BR/spring-concepts';

@Component({
  selector: 'app-spring-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './spring-concepts-list.html',
  styleUrl: './spring-concepts-list.css',
})
export class SpringConceptsListPage implements OnInit {
  private springConceptsService = inject(SpringConceptsService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = [PATH];

  concepts = signal<SpringConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<SpringConceptCategory | null>(null);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

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

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), SPRING_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

  constructor() {
    this.loading.set(true);
    this.springConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

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
      description: $localize`:@@springConceptsList.seo.description:Spring Boot, Spring Security, and Spring Batch concepts explained in depth — objective, use cases, deep dive, and trade-offs.`,
      path: PATH,
      alternates: [
        { lang: 'en', path: PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
