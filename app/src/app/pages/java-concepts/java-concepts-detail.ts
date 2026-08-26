import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbItem } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { JavaConceptView } from '../../components/java-concept-view/java-concept-view';
import { JavaConcept, JavaConceptSummary } from '../../models/java-concept.model';
import { Language } from '../../models/language.model';
import { JavaConceptsService } from '../../services/java-concepts.service';
import { LanguageService } from '../../services/language.service';
import { ReviewService } from '../../services/review.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';

const EN_PATH = '/java/java-concepts';
const PT_BR_PATH = '/pt-BR/java/java-concepts';

@Component({
  selector: 'app-java-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JavaConceptView, RouterLink, ConceptDetailLayout],
  templateUrl: './java-concepts-detail.html',
  styleUrl: './java-concepts-detail.css',
})
export class JavaConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private javaConceptsService = inject(JavaConceptsService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);

  concept = signal<JavaConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);
  private slugSignal = signal('');

  /** Set when this route is the locale-prefixed variant (/pt-BR/java/java-concepts) — the URL, not localStorage, decides the language for this page. */
  private readonly urlLocale = this.route.snapshot.data['locale'] as Language | undefined;
  protected readonly basePath = this.urlLocale === 'pt-BR' ? PT_BR_PATH : EN_PATH;

  nav = createConceptNavigation<JavaConceptSummary>(() => this.javaConceptsService.listConcepts());

  showFallbackNotice = computed(() => {
    const concept = this.concept();
    return concept != null && concept.language !== this.languageService.language();
  });

  sidebarItems = computed(() =>
    this.nav.allConcepts().map((c) => ({ slug: c.slug, label: c.title, read: c.read })),
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
      { name: 'Java Concepts', path: this.basePath },
      ...(concept ? [{ name: concept.title, path: `${this.basePath}/${concept.slug}` }] : []),
    ];
  });

  constructor() {
    if (this.urlLocale) this.languageService.setLanguageFromUrl(this.urlLocale);

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
    this.javaConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — Java Concepts`,
          description: concept.summary,
          path: `${this.basePath}/${concept.slug}`,
          type: 'article',
          publishedAt: concept.publishedAt,
          modifiedAt: concept.updatedAt,
          breadcrumbs: this.breadcrumbItems(),
          language: concept.language,
          alternates: this.alternatesFor(concept),
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); this.seo.setNotFound(); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.javaConceptsService.markRead(this.nav.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.nav.refetchList();
        this.xpService.loadSummary();
        this.reviewService.scheduleReview('java-concepts', this.nav.slug()).subscribe({ error: () => {} });
      },
      error: () => this.marking.set(false),
    });
  }

  /** Alternate-language URLs for hreflang — only for translations that actually exist, never the fallback. */
  private alternatesFor(concept: JavaConcept): { lang: Language; path: string }[] {
    const alternates: { lang: Language; path: string }[] = [{ lang: 'en', path: `${EN_PATH}/${concept.slug}` }];
    if (concept.availableLanguages.includes('pt-BR')) {
      alternates.push({ lang: 'pt-BR', path: `${PT_BR_PATH}/${concept.slug}` });
    }
    return alternates;
  }
}
