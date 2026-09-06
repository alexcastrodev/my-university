import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BreadcrumbItem } from '../../components/breadcrumbs/breadcrumbs';
import { ConceptDetailLayout } from '../../components/concept-detail-layout/concept-detail-layout';
import { CurriculumConceptView } from '../../components/curriculum-concept-view/curriculum-concept-view';
import { CurriculumConceptDetail, CurriculumConceptSummary } from '../../models/curriculum-concept.model';
import { CurriculumConceptsService } from '../../services/curriculum-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { createConceptNavigation } from '../../shared/concept-navigation';
import { CURRICULUM } from '../computer-science/curriculum.data';

@Component({
  selector: 'app-curriculum-concepts-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurriculumConceptView, RouterLink, ConceptDetailLayout],
  templateUrl: './curriculum-concepts-detail.html',
  styleUrl: './curriculum-concepts-detail.css',
})
export class CurriculumConceptsDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private curriculumConceptsService = inject(CurriculumConceptsService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);
  private xpService = inject(XpService);

  concept = signal<CurriculumConceptDetail | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);
  private moduleSignal = signal('');
  private disciplineSignal = signal('');
  private slugSignal = signal('');

  protected readonly basePath = computed(
    () => `/computer-science/${this.moduleSignal()}/${this.disciplineSignal()}`,
  );
  showFallbackNotice = computed(() => {
    const concept = this.concept();
    return concept != null && concept.language !== this.languageService.language;
  });

  protected readonly disciplineTitle = computed(() => {
    const mod = CURRICULUM.find((m) => m.slug === this.moduleSignal());
    const disc =
      mod?.disciplines?.find((d) => d.slug === this.disciplineSignal()) ??
      mod?.tracks?.find((t) => t.slug === this.disciplineSignal());
    return disc?.title ?? this.disciplineSignal();
  });

  nav = createConceptNavigation<CurriculumConceptSummary>(() =>
    this.curriculumConceptsService.listConcepts(this.moduleSignal(), this.disciplineSignal()),
  );

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
      { name: 'Computer Science', path: '/computer-science' },
      { name: this.disciplineTitle(), path: this.basePath() },
      ...(concept ? [{ name: concept.title, path: `${this.basePath()}/${concept.slug}` }] : []),
    ];
  });

  private lastListKey = '';

  constructor() {
    effect(() => {
      const slug = this.slugSignal();
      const mod = this.moduleSignal();
      const discipline = this.disciplineSignal();
      if (!slug || !mod || !discipline) return;
      this.loadConcept(mod, discipline, slug);
    });
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const mod = params.get('module') ?? '';
      const discipline = params.get('discipline') ?? '';
      this.moduleSignal.set(mod);
      this.disciplineSignal.set(discipline);
      this.slugSignal.set(params.get('slug') ?? '');

      const listKey = `${mod}/${discipline}`;
      if (listKey !== this.lastListKey) {
        this.lastListKey = listKey;
        this.nav.refetchList();
      }
    });
  }

  private loadConcept(mod: string, discipline: string, slug: string): void {
    this.nav.slug.set(slug);
    this.loading.set(true);
    this.notFound.set(false);
    this.marking.set(false);
    this.concept.set(null);
    this.curriculumConceptsService.getConcept(mod, discipline, slug).subscribe({
      next: (concept) => {
        this.concept.set(concept);
        this.read.set(concept.read);
        this.loading.set(false);
        this.seo.set({
          title: `${concept.title} — ${this.disciplineTitle()}`,
          description: concept.summary,
          path: `${this.basePath()}/${concept.slug}`,
          type: 'article',
          publishedAt: concept.publishedAt,
          modifiedAt: concept.updatedAt,
        });
      },
      error: () => {
        this.loading.set(false);
        this.notFound.set(true);
        this.seo.setNotFound();
      },
    });
  }

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.curriculumConceptsService
      .markRead(this.moduleSignal(), this.disciplineSignal(), this.nav.slug())
      .subscribe({
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
