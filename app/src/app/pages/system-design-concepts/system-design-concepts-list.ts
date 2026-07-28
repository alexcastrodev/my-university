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
  private systemDesignConceptsService = inject(SystemDesignConceptsService);
  private seo = inject(SeoService);

  concepts = signal<SystemDesignConceptSummary[]>([]);
  loading = signal(true);
  selectedTag = signal<string | null>(null);

  tagOptions = computed(() => {
    const tags = new Set<string>();
    for (const concept of this.concepts()) {
      for (const tag of concept.tags) tags.add(tag);
    }
    return [
      { label: 'All', value: null as string | null },
      ...Array.from(tags).sort().map((tag) => ({ label: tag, value: tag })),
    ];
  });

  filteredConcepts = computed(() => {
    const tag = this.selectedTag();
    const all = this.concepts();
    return tag ? all.filter((c) => c.tags.includes(tag)) : all;
  });

  onFilterChange(tag: string | null) {
    this.selectedTag.set(tag);
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
