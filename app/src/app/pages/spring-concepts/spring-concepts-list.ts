import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SpringConceptSummary } from '../../models/spring-concept.model';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-spring-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './spring-concepts-list.html',
  styleUrl: './spring-concepts-list.css',
})
export class SpringConceptsListPage implements OnInit {
  private springConceptsService = inject(SpringConceptsService);
  private seo = inject(SeoService);

  concepts = signal<SpringConceptSummary[]>([]);
  loading = signal(true);

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
