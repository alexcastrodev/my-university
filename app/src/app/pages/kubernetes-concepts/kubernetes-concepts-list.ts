import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { KubernetesConceptCategory, KubernetesConceptSummary } from '../../models/kubernetes-concept.model';
import { KubernetesConceptsService } from '../../services/kubernetes-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: KubernetesConceptCategory | null }[] = [
  { label: 'concepts.filters.all', value: null },
  { label: 'kubernetesConcepts.category.secretsConfiguration', value: 'Secrets & Configuration' },
];

export interface KubernetesConceptTopicGroup {
  topic: string;
  concepts: KubernetesConceptSummary[];
}

const TOPIC_ORDER = [
  'Core Configuration',
  'Caching & Auditing',
  'Multitenancy',
  'Customization & Migration',
  'Modern Data Access',
  'Extensions & Tooling',
];

@Component({
  selector: 'app-kubernetes-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './kubernetes-concepts-list.html',
  styleUrl: './kubernetes-concepts-list.css',
})
export class KubernetesConceptsListPage implements OnInit {
  private kubernetesConceptsService = inject(KubernetesConceptsService);
  private seo = inject(SeoService);

  protected readonly CATEGORY_OPTIONS = CATEGORY_OPTIONS;
  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/kubernetes-concepts'];

  concepts = signal<KubernetesConceptSummary[]>([]);
  loading = signal(true);
  selectedCategory = signal<KubernetesConceptCategory | null>(null);
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

  groupedConcepts = computed<KubernetesConceptTopicGroup[]>(() => {
    const byTopic = new Map<string, KubernetesConceptSummary[]>();
    for (const concept of this.filteredConcepts()) {
      const group = byTopic.get(concept.topic);
      if (group) group.push(concept);
      else byTopic.set(concept.topic, [concept]);
    }

    const known = TOPIC_ORDER.filter((topic) => byTopic.has(topic));
    const unknown = [...byTopic.keys()].filter((topic) => !TOPIC_ORDER.includes(topic)).sort();
    return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
  });

  onFilterChange(category: KubernetesConceptCategory | null) {
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
      title: 'Kubernetes Concepts',
      description: 'Kubernetes explained in depth, starting with Secrets: how they are created, mounted, projected and rotated in a real cluster.',
      path: '/kubernetes-concepts',
    });

    this.kubernetesConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
