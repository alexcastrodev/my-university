import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbItem } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { SpringConceptView } from '../../components/spring-concept-view/spring-concept-view';
import { SpringConcept, SpringConceptSummary } from '../../models/spring-concept.model';
import { Language } from '../../models/language.model';
import { ReviewService } from '../../services/review.service';
import { SpringConceptsService } from '../../services/spring-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';

const PATH = '/spring-concepts';
const PT_BR_PATH = '/pt-BR/spring-concepts';

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
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);
  
  concept = signal<SpringConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);
  private slugSignal = signal('');

  protected readonly basePath = PATH;
  protected readonly backLabelText = $localize`:@@springConcepts.title:Spring Concepts`;

  nav = createConceptNavigation<SpringConceptSummary>(() => this.springConceptsService.listConcepts());

  showFallbackNotice = computed(() => {
    const concept = this.concept();
    return concept != null && concept.language !== this.languageService.language();
  });

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
      { name: $localize`:@@springConcepts.title:Spring Concepts`, path: this.basePath },
      ...(concept ? [{ name: concept.title, path: `${this.basePath}/${concept.slug}` }] : []),
    ];
  });

  constructor() {
    effect(() => {
      this.languageService.language();
      this.nav.refetchList();
    });

    effect(() => {
      const slug = this.slugSignal();
      this.languageService.language();
      if (!slug) return;
      this.loadConcept(slug);
    });
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      this.slugSignal.set(params.get('slug') ?? '');
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
          path: `${this.basePath}/${concept.slug}`,
          type: 'article',
          publishedAt: concept.publishedAt,
          modifiedAt: concept.updatedAt,
          breadcrumbs: this.breadcrumbItems(),
          alternates: this.alternatesFor(concept),
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); this.seo.setNotFound(); },
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

  /** Alternate-language URLs for hreflang — only for translations that actually exist, never the fallback. */
  private alternatesFor(concept: SpringConcept): { lang: Language; path: string }[] {
    const alternates: { lang: Language; path: string }[] = [{ lang: 'en', path: `${PATH}/${concept.slug}` }];
    if (concept.availableLanguages.includes('pt-BR')) {
      alternates.push({ lang: 'pt-BR', path: `${PT_BR_PATH}/${concept.slug}` });
    }
    return alternates;
  }
}
