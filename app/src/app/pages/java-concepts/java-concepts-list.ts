import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { JavaConceptSummary } from '../../models/java-concept.model';
import { JavaConceptsService } from '../../services/java-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

export interface JavaConceptTopicGroup {
  topic: string;
  concepts: JavaConceptSummary[];
}

/** Pedagogical order — roughly the order a learner would want to progress through, not alphabetical. */
const TOPIC_ORDER = [
  'Collections',
  'Concurrency',
  'Language Features',
  'API Design & Craft',
  'Core APIs & Tooling',
  'I/O & Networking',
];

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
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  groupedConcepts = computed<JavaConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, JavaConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

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
