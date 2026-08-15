import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { JavaMinuteEpisodeView } from '../../components/java-minute-episode/java-minute-episode';
import { JavaMinuteEpisode, JavaMinuteEpisodeSummary } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';
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
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  private reviewService = inject(ReviewService);

  episode = signal<JavaMinuteEpisode | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  nav = createConceptNavigation<JavaMinuteEpisodeSummary>(() => this.javaMinuteService.listEpisodes());

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

  ngOnInit() {
    this.nav.refetchList();
    this.route.paramMap.subscribe((params) => {
      this.loadEpisode(params.get('slug') ?? '');
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
          path: `/java/java-minute/${episode.slug}`,
          type: 'article',
          publishedAt: episode.publishedAt,
          modifiedAt: episode.updatedAt,
          qa: { question: episode.question, answerText: this.qaAnswerText(episode) },
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
