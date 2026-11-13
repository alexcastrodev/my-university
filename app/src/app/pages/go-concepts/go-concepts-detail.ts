import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { BreadcrumbItem } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { GoConceptView } from '../../components/go-concept-view/go-concept-view';
import { GO_CONCEPT_TOPIC_ORDER, GoConcept, GoConceptSummary } from '../../models/go-concept.model';
import { GoConceptsService } from '../../services/go-concepts.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';
import { orderByTopic } from '../../shared/concept-topics';

@Component({
  selector: 'app-go-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GoConceptView, RouterLink, ConceptDetailLayout],
  templateUrl: './go-concepts-detail.html',
  styleUrl: './go-concepts-detail.css',
})
export class GoConceptsDetailPage implements OnInit {
  protected readonly backLabelText = $localize`:@@goConcepts.title:Go Concepts`;
  private route = inject(ActivatedRoute);
  private goConceptsService = inject(GoConceptsService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);
  
  concept = signal<GoConcept | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  nav = createConceptNavigation<GoConceptSummary>(() =>
    this.goConceptsService.listConcepts().pipe(map((list) => orderByTopic(list, GO_CONCEPT_TOPIC_ORDER))),
  );

  /** The topic of the open concept: the sidebar lists only that topic, like its group on the list page. */
  currentTopic = computed(() => this.nav.allConcepts().find((c) => c.slug === this.nav.slug())?.topic ?? null);
  sidebarItems = computed(() =>
    this.nav
      .allConcepts()
      .filter((c) => c.topic === this.currentTopic())
      .map((c) => ({ slug: c.slug, label: c.title, read: c.read })),
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
      { name: $localize`:@@goConcepts.title:Go Concepts`, path: '/go-concepts' },
      ...(concept ? [{ name: concept.title, path: `/go-concepts/${concept.slug}` }] : []),
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
    this.goConceptsService.getConcept(slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} | Go Concepts`,
          description: concept.summary,
          path: `/go-concepts/${concept.slug}`,
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
    this.goConceptsService.markRead(this.nav.slug()).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.nav.refetchList();
        this.xpService.loadSummary();
      },
      error: () => this.marking.set(false),
    });
  }
}
