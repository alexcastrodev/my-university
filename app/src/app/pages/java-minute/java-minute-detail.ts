import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbItem } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { JavaMinuteEpisodeView } from '../../components/java-minute-episode/java-minute-episode';
import { JavaMinuteEpisode, JavaMinuteEpisodeSummary } from '../../models/java-minute.model';
import { Language } from '../../models/language.model';
import { JavaMinuteService } from '../../services/java-minute.service';
import { LanguageService } from '../../services/language.service';
import { ReviewService } from '../../services/review.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { pickLeadSection } from '../../shared/concept-sections';
import { createConceptNavigation } from '../../shared/concept-navigation';

@Component({
  selector: 'app-java-minute-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JavaMinuteEpisodeView, RouterLink, ConceptDetailLayout],
  templateUrl: './java-minute-detail.html',
  styleUrl: './java-minute-detail.css',
})
export class JavaMinuteDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private javaMinuteService = inject(JavaMinuteService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);
  
  episode = signal<JavaMinuteEpisode | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);
  private slugSignal = signal('');

  /** Set when this route is a locale-prefixed variant (e.g. /pt-BR/java/java-minute/:slug) — the URL, not localStorage, decides the language for this page. */
  private readonly urlLocale = this.route.snapshot.data['locale'] as Language | undefined;
  protected readonly basePath = this.urlLocale === 'pt-BR' ? '/pt-BR/java/java-minute' : '/java/java-minute';
  protected readonly backLabelText = $localize`:@@javaMinute.title:Java Minute`;

  nav = createConceptNavigation<JavaMinuteEpisodeSummary>(() => this.javaMinuteService.listEpisodes());

  showFallbackNotice = computed(() => {
    const episode = this.episode();
    return episode != null && episode.language !== this.languageService.language();
  });

  sidebarItems = computed(() =>
    this.nav.allConcepts().map((e) => ({ slug: e.slug, label: e.question, read: e.read })),
  );
  prevItem = computed(() => {
    const p = this.nav.prevConcept();
    return p ? { slug: p.slug, label: p.question } : null;
  });
  nextItem = computed(() => {
    const n = this.nav.nextConcept();
    return n ? { slug: n.slug, label: n.question } : null;
  });
  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const episode = this.episode();
    return [
      { name: $localize`:@@javaMinute.title:Java Minute`, path: this.basePath },
      ...(episode ? [{ name: episode.question, path: `${this.basePath}/${episode.slug}` }] : []),
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
      this.loadEpisode(slug);
    });
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      this.slugSignal.set(params.get('slug') ?? '');
    });
  }

  private loadEpisode(slug: string): void {
    this.nav.slug.set(slug);
    this.loading.set(true);
    this.notFound.set(false);
    this.marking.set(false);
    this.episode.set(null);
    this.javaMinuteService.getEpisode(slug).subscribe({
      next: (episode) => {
        this.episode.set(episode);
        this.read.set(episode.read);
        this.loading.set(false);
        this.seo.set({
          title: `${episode.question} — Java Minute`,
          description: this.summarize(episode),
          path: `${this.basePath}/${episode.slug}`,
          type: 'article',
          publishedAt: episode.publishedAt,
          modifiedAt: episode.updatedAt,
          qa: { question: episode.question, answerText: this.qaAnswerText(episode) },
          breadcrumbs: this.breadcrumbItems(),
          language: episode.language,
          alternates: this.alternatesFor(episode),
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); this.seo.setNotFound(); },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.javaMinuteService.markRead(this.nav.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.nav.refetchList();
        this.xpService.loadSummary();
        this.reviewService.scheduleReview('java-minute', this.nav.slug()).subscribe({ error: () => {} });
      },
      error: () => this.marking.set(false),
    });
  }

  /** Alternate-language URLs for hreflang — only for translations that actually exist, never the fallback. */
  private alternatesFor(episode: JavaMinuteEpisode): { lang: Language; path: string }[] {
    const alternates: { lang: Language; path: string }[] = [{ lang: 'en', path: `/java/java-minute/${episode.slug}` }];
    if (episode.availableLanguages.includes('pt-BR')) {
      alternates.push({ lang: 'pt-BR', path: `/pt-BR/java/java-minute/${episode.slug}` });
    }
    return alternates;
  }

  private summarize(episode: JavaMinuteEpisode): string {
    return this.plainTextFrom(episode, 200);
  }

  /** Answer text for QAPage structured data — same source as the meta description, just less truncated. */
  private qaAnswerText(episode: JavaMinuteEpisode): string {
    return this.plainTextFrom(episode, 600);
  }

  private plainTextFrom(episode: JavaMinuteEpisode, maxLength: number): string {
    const text = pickLeadSection(episode.sections)?.content ?? episode.question;
    const plain = text.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > maxLength ? `${plain.slice(0, maxLength - 3)}...` : plain;
  }
}
