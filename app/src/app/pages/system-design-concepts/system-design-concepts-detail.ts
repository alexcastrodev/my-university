import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConceptSidebarNav } from '../../components/concept-sidebar-nav/concept-sidebar-nav';
import { ReadingProgressBar } from '../../components/reading-progress-bar/reading-progress-bar';
import { SystemDesignConceptView } from '../../components/system-design-concept-view/system-design-concept-view';
import { SystemDesignConcept, SystemDesignConceptSummary } from '../../models/system-design-concept.model';
import { ReviewService } from '../../services/review.service';
import { SystemDesignConceptsService } from '../../services/system-design-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-system-design-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SystemDesignConceptView, RouterLink, ReadingProgressBar, ConceptSidebarNav],
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
  allConcepts = signal<SystemDesignConceptSummary[]>([]);

  slug = signal('');

  currentIndex = computed(() => this.allConcepts().findIndex((c) => c.slug === this.slug()));
  prevConcept = computed(() => {
    const i = this.currentIndex();
    return i > 0 ? this.allConcepts()[i - 1] : null;
  });
  nextConcept = computed(() => {
    const i = this.currentIndex();
    const list = this.allConcepts();
    return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  });

  ngOnInit() {
    this.systemDesignConceptsService.listConcepts().subscribe({
      next: (concepts) => this.allConcepts.set(concepts),
      error: () => {},
    });
    this.route.paramMap.subscribe((params) => {
      this.loadConcept(params.get('slug') ?? '');
    });
  }

  private loadConcept(slug: string): void {
    this.slug.set(slug);
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
    this.systemDesignConceptsService.markRead(this.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.xpService.loadSummary();
        this.reviewService.scheduleReview('system-design-concepts', this.slug()).subscribe({ error: () => {} });
      },
      error: () => this.marking.set(false),
    });
  }
}
