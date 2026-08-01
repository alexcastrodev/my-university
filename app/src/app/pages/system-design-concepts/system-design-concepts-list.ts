import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SystemDesignConceptSummary } from '../../models/system-design-concept.model';
import { SystemDesignConceptsService } from '../../services/system-design-concepts.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-system-design-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './system-design-concepts-list.html',
  styleUrl: './system-design-concepts-list.css',
})
export class SystemDesignConceptsListPage implements OnInit {
  private static readonly VISIBLE_TAG_LIMIT = 10;

  private systemDesignConceptsService = inject(SystemDesignConceptsService);
  private seo = inject(SeoService);

  concepts = signal<SystemDesignConceptSummary[]>([]);
  loading = signal(true);
  selectedTag = signal<string | null>(null);
  showAllTags = signal(false);

  /** Tags ranked by how many concepts use them (most common first, alphabetical tiebreak). */
  rankedTagOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const concept of this.concepts()) {
      for (const tag of concept.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB))
      .map(([tag]) => ({ label: tag, value: tag as string | null }));
  });

  visibleTagOptions = computed(() => {
    const ranked = this.rankedTagOptions();
    return this.showAllTags() ? ranked : ranked.slice(0, SystemDesignConceptsListPage.VISIBLE_TAG_LIMIT);
  });

  hasMoreTags = computed(() => this.rankedTagOptions().length > SystemDesignConceptsListPage.VISIBLE_TAG_LIMIT);

  hiddenTagCount = computed(() => this.rankedTagOptions().length - SystemDesignConceptsListPage.VISIBLE_TAG_LIMIT);

  showOnlyLabs = signal(false);

  filteredConcepts = computed(() => {
    const tag = this.selectedTag();
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();

    return all.filter((c) => {
      const matchesTag = !tag || c.tags.includes(tag);
      const matchesLab = !showLabs || c.labUrl;
      return matchesTag && matchesLab;
    });
  });

  onFilterChange(tag: string | null) {
    this.selectedTag.set(tag);
  }

  onToggleShowAllTags() {
    this.showAllTags.update((v) => !v);
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  ngOnInit() {
    this.seo.set({
      title: 'System Design Concepts',
      description: 'Distributed systems and architecture concepts explained in depth — overview, architecture, guarantees, trade-offs, and interview questions.',
      path: '/system-design/system-design-concepts',
    });

    this.systemDesignConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
