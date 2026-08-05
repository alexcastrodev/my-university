import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { SpringConceptView } from '../../components/spring-concept-view/spring-concept-view';
import { SpringConcept, SpringConceptSummary } from '../../models/spring-concept.model';
import { ReviewService } from '../../services/review.service';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';

@Component({
  selector: 'app-spring-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpringConceptView, RouterLink, ConceptDetailLayout],
  templateUrl: './spring-concepts-detail.html',
  styleUrl: './spring-concepts-detail.css',
})
export class SpringConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private springConceptsService = inject(SpringConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);

  concept = signal<SpringConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  nav = createConceptNavigation<SpringConceptSummary>(() => this.springConceptsService.listConcepts());

  sidebarItems = computed(() =>
    this.nav.allConcepts().map((c) => ({ slug: c.slug, label: c.title, read: c.read, badge: c.category })),
  );
  prevItem = computed(() => {
    const p = this.nav.prevConcept();
    return p ? { slug: p.slug, label: p.title } : null;
  });
  nextItem = computed(() => {
    const n = this.nav.nextConcept();
    return n ? { slug: n.slug, label: n.title } : null;
  });

  ngOnInit() {
    this.nav.refetchList();
    this.route.paramMap.subscribe((params) => {
      this.loadConcept(params.get('slug') ?? '');
    });
  }

  private loadConcept(slug: string): void {
    this.nav.slug.set(slug);
    this.loading.set(true);
    this.notFound.set(false);
    this.marking.set(false);
    this.concept.set(null);
    this.springConceptsService.getConcept(slug).subscribe({
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
    this.springConceptsService.markRead(this.nav.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.nav.refetchList();
        this.xpService.loadSummary();
        this.reviewService.scheduleReview('spring-concepts', this.nav.slug()).subscribe({ error: () => {} });
      },
      error: () => this.marking.set(false),
    });
  }
}
