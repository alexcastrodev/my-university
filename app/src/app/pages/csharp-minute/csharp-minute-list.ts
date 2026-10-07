import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CSharpMinuteEpisodeSummary } from '../../models/csharp-minute.model';
import { CSharpMinuteService } from '../../services/csharp-minute.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

const PATH = '/csharp-minute';
const PT_BR_PATH = '/pt-BR/csharp-minute';

@Component({
  selector: 'app-csharp-minute-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './csharp-minute-list.html',
  styleUrl: '../java-minute/java-minute-list.css',
})
export class CSharpMinuteListPage implements OnInit {
  private cSharpMinuteService = inject(CSharpMinuteService);
  private languageService = inject(LanguageService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;
  protected readonly basePath = PATH;

  episodes = signal<CSharpMinuteEpisodeSummary[]>([]);
  loading = signal(true);
  readSort = signal<ReadSortOrder>('default');

  sortedEpisodes = computed(() => sortByRead(this.episodes(), this.readSort()));

  constructor() {
    this.loading.set(true);
    this.cSharpMinuteService.listEpisodes().subscribe({
      next: (list) => { this.episodes.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.seo.set({
      title: 'C# Minute',
      description: $localize`:@@csharpMinuteList.seo.description:Short, sharp answers to tricky C# questions, one episode at a time.`,
      path: PATH,
      alternates: [
        { lang: 'en', path: PATH },
        { lang: 'pt-BR', path: PT_BR_PATH },
      ],
    });
  }
}
