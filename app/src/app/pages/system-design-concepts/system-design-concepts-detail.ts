import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { SystemDesignConceptView } from '../../components/system-design-concept-view/system-design-concept-view';
import { SystemDesignConcept, SystemDesignConceptSummary } from '../../models/system-design-concept.model';
import { ReviewService } from '../../services/review.service';
import { SystemDesignConceptsService } from '../../services/system-design-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';

@Component({
  selector: 'app-system-design-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SystemDesignConceptView, RouterLink, ConceptDetailLayout],
  templateUrl: './system-design-concepts-detail.html',
  styleUrl: './system-design-concepts-detail.css',
})
export class SystemDesignConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private systemDesignConceptsService = inject(SystemDesignConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);

  concept = signal<SystemDesignConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  nav = createConceptNavigation<SystemDesignConceptSummary>();

  sidebarItems = computed(() =>
    this.nav.allConcepts().map((c) => ({ slug: c.slug, label: c.title, read: c.read, badge: c.difficulty })),
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
    this.systemDesignConceptsService.listConcepts().subscribe({
      next: (concepts) => this.nav.allConcepts.set(concepts),
      error: () => {},
    });
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
    this.systemDesignConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — System Design`,
          description: concept.summary,
          path: `/system-design/system-design-concepts/${concept.slug}`,
          type: 'article',
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.systemDesignConceptsService.markRead(this.nav.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.xpService.loadSummary();
        this.reviewService.scheduleReview('system-design-concepts', this.nav.slug()).subscribe({ error: () => {} });
      },
      error: () => this.marking.set(false),
    });
  }
}
