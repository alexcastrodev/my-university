import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { JAVA_CONCEPT_TOPIC_ORDER, JavaConceptSummary } from '../../models/java-concept.model';
import { JavaConceptsService } from '../../services/java-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { ConceptTopicGroup, groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const PATH = '/java/java-concepts';
const PT_BR_PATH = '/pt-BR/java/java-concepts';

@Component({
  selector: 'app-java-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './java-concepts-list.html',
  styleUrl: './java-concepts-list.css',
})
export class JavaConceptsListPage implements OnInit {
  private javaConceptsService = inject(JavaConceptsService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = [PATH];

  concepts = signal<JavaConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  groupedConcepts = computed<ConceptTopicGroup<JavaConceptSummary>[]>(() =>
    groupByTopic(this.filteredConcepts(), JAVA_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

  constructor() {
    this.loading.set(true);
    this.javaConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Java Concepts',
      description: $localize`:@@javaConceptsList.seo.description:Core Java concepts explained in depth — objective, use cases, deep dive, and trade-offs.`,
      path: PATH,
      alternates: [
        { lang: 'en', path: PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
