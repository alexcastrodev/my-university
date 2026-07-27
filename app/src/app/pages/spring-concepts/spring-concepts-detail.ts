import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SpringConceptView } from '../../components/spring-concept-view/spring-concept-view';
import { SpringConcept } from '../../models/spring-concept.model';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-spring-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpringConceptView, RouterLink],
  templateUrl: './spring-concepts-detail.html',
  styleUrl: './spring-concepts-detail.css',
})
export class SpringConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private springConceptsService = inject(SpringConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);

  concept = signal<SpringConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  private slug = '';

  ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.springConceptsService.getConcept(this.slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — Spring Concepts`,
          description: concept.summary,
          path: `/spring-concepts/${concept.slug}`,
          type: 'article',
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.springConceptsService.markRead(this.slug).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.xpService.loadSummary();
      },
      error: () => this.marking.set(false),
    });
  }
}
