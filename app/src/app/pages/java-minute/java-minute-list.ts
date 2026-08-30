import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JavaMinuteEpisodeSummary } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const PATH = '/java/java-minute';
const PT_BR_PATH = '/pt-BR/java/java-minute';

@Component({
  selector: 'app-java-minute-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './java-minute-list.html',
  styleUrl: './java-minute-list.css',
})
export class JavaMinuteListPage implements OnInit {
  private javaMinuteService = inject(JavaMinuteService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly basePath = PATH;

  episodes = signal<JavaMinuteEpisodeSummary[]>([]);
  loading = signal(true);
  readSort = signal<ReadSortOrder>('default');

  sortedEpisodes = computed(() => sortByRead(this.episodes(), this.readSort()));

  constructor() {
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
    this.seo.set({
      title: 'Java Minute',
      description: $localize`:@@javaMinuteList.seo.description:Short, sharp answers to tricky Java questions — one episode at a time.`,
      path: PATH,
      alternates: [
        { lang: 'en', path: PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
