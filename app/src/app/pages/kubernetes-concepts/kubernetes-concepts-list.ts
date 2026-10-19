import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { KUBERNETES_CONCEPT_TOPIC_ORDER, KubernetesConceptCategory, KubernetesConceptSummary } from '../../models/kubernetes-concept.model';
import { KubernetesConceptsService } from '../../services/kubernetes-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const CATEGORY_OPTIONS: { label: string; value: KubernetesConceptCategory | null }[] = [
  { label: 'concepts.filters.all', value: null },
  { label: 'kubernetesConcepts.category.microk8sCluster', value: 'MicroK8s Cluster' },
  { label: 'kubernetesConcepts.category.workloads', value: 'Workloads' },
  { label: 'kubernetesConcepts.category.secretsConfiguration', value: 'Secrets & Configuration' },
  { label: 'kubernetesConcepts.category.networking', value: 'Networking' },
  { label: 'kubernetesConcepts.category.storageBackups', value: 'Storage & Backups' },
  { label: 'kubernetesConcepts.category.kustomize', value: 'Kustomize' },
  { label: 'kubernetesConcepts.category.deliveryOperations', value: 'Delivery & Operations' },
  { label: 'kubernetesConcepts.category.troubleshooting', value: 'Troubleshooting' },
  { label: 'kubernetesConcepts.category.observability', value: 'Observability' },
  { label: 'kubernetesConcepts.category.security', value: 'Security' },
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

    return all.filter((c) => {
      const matchesCategory = !category || c.category === category;
      const matchesLab = !showLabs || c.labUrl;
      return matchesCategory && matchesLab;
    });
  });

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), KUBERNETES_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

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
      description: 'Kubernetes in practice: workloads, configuration, networking, storage, Kustomize, operations, troubleshooting, observability and security, verified on real MicroK8s and k3s clusters.',
      path: '/kubernetes-concepts',
    });

    this.kubernetesConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
