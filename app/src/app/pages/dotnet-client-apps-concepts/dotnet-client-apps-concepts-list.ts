import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DOTNET_CLIENT_APPS_CONCEPT_TOPIC_ORDER, DotnetClientAppsConceptSummary } from '../../models/dotnet-client-apps-concept.model';
import { DotnetClientAppsConceptsService } from '../../services/dotnet-client-apps-concepts.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { groupByTopic } from '../../shared/concept-topics';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-dotnet-client-apps-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent],
  templateUrl: './dotnet-client-apps-concepts-list.html',
  styleUrl: './dotnet-client-apps-concepts-list.css',
})
export class DotnetClientAppsConceptsListPage implements OnInit {
  private dotnetClientAppsConceptsService = inject(DotnetClientAppsConceptsService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly ROUTE_COMMANDS = ['/dotnet-client-apps-concepts'];

  concepts = signal<DotnetClientAppsConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  groupedConcepts = computed(() =>
    groupByTopic(this.filteredConcepts(), DOTNET_CLIENT_APPS_CONCEPT_TOPIC_ORDER).map((group) => ({
      topic: group.topic,
      // Numbered inside the topic (1, 2, 3...), the same list the article sidebar shows.
      concepts: sortByRead(group.concepts, this.readSort()),
    })),
  );

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Client Apps for .NET Concepts',
      description: 'Desktop and cross-platform client apps in .NET explained in depth, one at a time: MVVM and data binding, and choosing a UI framework.',
      path: '/dotnet-client-apps-concepts',
    });

    this.dotnetClientAppsConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
