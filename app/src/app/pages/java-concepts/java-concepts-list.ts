import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JavaConceptSummary } from '../../models/java-concept.model';
import { JavaConceptsService } from '../../services/java-concepts.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-java-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './java-concepts-list.html',
  styleUrl: './java-concepts-list.css',
})
export class JavaConceptsListPage implements OnInit {
  private javaConceptsService = inject(JavaConceptsService);
  private seo = inject(SeoService);

  concepts = signal<JavaConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    return showLabs ? all.filter((c) => c.labUrl) : all;
  });

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Java Concepts',
      description: 'Core Java concepts explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: '/java/java-concepts',
    });

    this.javaConceptsService.listConcepts().subscribe({
      next: (list) => { this.concepts.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
