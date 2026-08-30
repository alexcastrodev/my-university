import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JavaMinuteEpisodeSummary } from '../../models/java-minute.model';
import { Language } from '../../models/language.model';
import { JavaMinuteService } from '../../services/java-minute.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const EN_PATH = '/java/java-minute';
const PT_BR_PATH = '/pt-BR/java/java-minute';

@Component({
  selector: 'app-java-minute-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './java-minute-list.html',
  styleUrl: './java-minute-list.css',
})
export class JavaMinuteListPage implements OnInit {
  private route = inject(ActivatedRoute);
  private javaMinuteService = inject(JavaMinuteService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;

  /** Set when this route is the locale-prefixed variant (/pt-BR/java/java-minute) — the URL, not localStorage, decides the language for this page. */
  private readonly urlLocale = this.route.snapshot.data['locale'] as Language | undefined;
  protected readonly basePath = this.urlLocale === 'pt-BR' ? PT_BR_PATH : EN_PATH;

  episodes = signal<JavaMinuteEpisodeSummary[]>([]);
  loading = signal(true);
  readSort = signal<ReadSortOrder>('default');

  sortedEpisodes = computed(() => sortByRead(this.episodes(), this.readSort()));

  constructor() {
    if (this.urlLocale) this.languageService.setLanguageFromUrl(this.urlLocale);

    effect(() => {
      this.languageService.language();
      this.loading.set(true);
      this.javaMinuteService.listEpisodes().subscribe({
        next: (list) => { this.episodes.set(list); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    });
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    const isPtBr = this.urlLocale === 'pt-BR';
    this.seo.set({
      title: 'Java Minute',
      description: isPtBr
        ? 'Respostas curtas e diretas pra perguntas específicas de Java — um episódio de cada vez.'
        : 'Short, sharp answers to tricky Java questions — one episode at a time.',
      path: this.basePath,
      language: isPtBr ? 'pt-BR' : 'en',
      alternates: [
        { lang: 'en', path: EN_PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
