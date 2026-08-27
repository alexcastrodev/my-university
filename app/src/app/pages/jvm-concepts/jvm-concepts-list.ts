import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { JvmConceptSummary } from '../../models/jvm-concept.model';
import { Language } from '../../models/language.model';
import { JvmConceptsService } from '../../services/jvm-concepts.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { ConceptCardListComponent } from '../../shared/concept-card-list/concept-card-list';
import { ConceptViewToggleComponent } from '../../shared/concept-card-list/concept-view-toggle';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';

const EN_PATH = '/java/jvm-concepts';
const PT_BR_PATH = '/pt-BR/java/jvm-concepts';

@Component({
  selector: 'app-jvm-concepts-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConceptCardListComponent, ConceptViewToggleComponent, TranslatePipe],
  templateUrl: './jvm-concepts-list.html',
  styleUrl: './jvm-concepts-list.css',
})
export class JvmConceptsListPage implements OnInit {
  private route = inject(ActivatedRoute);
  private jvmConceptsService = inject(JvmConceptsService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;

  /** Set when this route is the locale-prefixed variant (/pt-BR/java/jvm-concepts) — the URL, not localStorage, decides the language for this page. */
  private readonly urlLocale = this.route.snapshot.data['locale'] as Language | undefined;
  protected readonly basePath = this.urlLocale === 'pt-BR' ? PT_BR_PATH : EN_PATH;
  protected readonly ROUTE_COMMANDS = [this.basePath];

  concepts = signal<JvmConceptSummary[]>([]);
  loading = signal(true);
  showOnlyLabs = signal(false);
  readSort = signal<ReadSortOrder>('default');

  filteredConcepts = computed(() => {
    const showLabs = this.showOnlyLabs();
    const all = this.concepts();
    const filtered = showLabs ? all.filter((c) => c.labUrl) : all;
    return sortByRead(filtered, this.readSort());
  });

  constructor() {
    if (this.urlLocale) this.languageService.setLanguageFromUrl(this.urlLocale);

    effect(() => {
      this.languageService.language();
      this.loading.set(true);
      this.jvmConceptsService.listConcepts().subscribe({
        next: (list) => { this.concepts.set(list); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    });
  }

  onToggleLabsFilter() {
    this.showOnlyLabs.update((v) => !v);
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    const isPtBr = this.urlLocale === 'pt-BR';
    this.seo.set({
      title: 'JVM Concepts',
      description: isPtBr
        ? 'Como a JVM funciona por baixo dos panos, explicado a fundo — objetivo, casos de uso, deep dive e trade-offs.'
        : 'How the JVM works under the hood, explained in depth — objective, use cases, deep dive, and trade-offs.',
      path: this.basePath,
      language: isPtBr ? 'pt-BR' : 'en',
      alternates: [
        { lang: 'en', path: EN_PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
