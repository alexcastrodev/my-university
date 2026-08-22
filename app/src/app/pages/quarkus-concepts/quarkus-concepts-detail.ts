import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbItem } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { QuarkusConceptView } from '../../components/quarkus-concept-view/quarkus-concept-view';
import { QuarkusConcept, QuarkusConceptSummary } from '../../models/quarkus-concept.model';
import { ReviewService } from '../../services/review.service';
import { QuarkusConceptsService } from '../../services/quarkus-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';

@Component({
  selector: 'app-quarkus-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuarkusConceptView, RouterLink, ConceptDetailLayout],
  templateUrl: './quarkus-concepts-detail.html',
  styleUrl: './quarkus-concepts-detail.css',
})
export class QuarkusConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private quarkusConceptsService = inject(QuarkusConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);

  concept = signal<QuarkusConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  nav = createConceptNavigation<QuarkusConceptSummary>(() => this.quarkusConceptsService.listConcepts());

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
  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const concept = this.concept();
    return [
      { name: 'Quarkus Concepts', path: '/quarkus-concepts' },
      ...(concept ? [{ name: concept.title, path: `/quarkus-concepts/${concept.slug}` }] : []),
    ];
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
    this.quarkusConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — Quarkus Concepts`,
          description: concept.summary,
          path: `/quarkus-concepts/${concept.slug}`,
          type: 'article',
          publishedAt: concept.publishedAt,
          modifiedAt: concept.updatedAt,
          breadcrumbs: this.breadcrumbItems(),
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); this.seo.setNotFound(); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.quarkusConceptsService.markRead(this.nav.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.nav.refetchList();
        this.xpService.loadSummary();
        this.reviewService.scheduleReview('quarkus-concepts', this.nav.slug()).subscribe({ error: () => {} });
      },
      error: () => this.marking.set(false),
    });
  }
}
