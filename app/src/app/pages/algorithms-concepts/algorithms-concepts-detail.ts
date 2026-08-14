import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AlgorithmsConceptView } from '../../components/algorithms-concept-view/algorithms-concept-view';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { AlgorithmsConcept, AlgorithmsConceptSummary } from '../../models/algorithms-concept.model';
import { AlgorithmsConceptsService } from '../../services/algorithms-concepts.service';
import { ReviewService } from '../../services/review.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';

@Component({
  selector: 'app-algorithms-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlgorithmsConceptView, RouterLink, ConceptDetailLayout],
  templateUrl: './algorithms-concepts-detail.html',
  styleUrl: './algorithms-concepts-detail.css',
})
export class AlgorithmsConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private algorithmsConceptsService = inject(AlgorithmsConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);

  concept = signal<AlgorithmsConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  nav = createConceptNavigation<AlgorithmsConceptSummary>(() => this.algorithmsConceptsService.listConcepts());

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
    this.algorithmsConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — Algorithms`,
          description: concept.summary,
          path: `/algorithms/algorithms-concepts/${concept.slug}`,
          type: 'article',
          publishedAt: concept.publishedAt,
          modifiedAt: concept.updatedAt,
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); this.seo.setNotFound(); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.algorithmsConceptsService.markRead(this.nav.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.nav.refetchList();
        this.xpService.loadSummary();
        this.reviewService.scheduleReview('algorithms-concepts', this.nav.slug()).subscribe({ error: () => {} });
      },
      error: () => this.marking.set(false),
    });
  }
}
