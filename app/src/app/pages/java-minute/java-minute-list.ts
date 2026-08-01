import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JavaMinuteEpisodeSummary } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';
import { SeoService } from '../../services/seo.service';
import { READ_SORT_OPTIONS, ReadSortOrder, sortByRead } from '../../shared/read-sort';

@Component({
  selector: 'app-java-minute-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './java-minute-list.html',
  styleUrl: './java-minute-list.css',
})
export class JavaMinuteListPage implements OnInit {
  private javaMinuteService = inject(JavaMinuteService);
  private seo = inject(SeoService);

  protected readonly READ_SORT_OPTIONS = READ_SORT_OPTIONS;

  episodes = signal<JavaMinuteEpisodeSummary[]>([]);
  loading = signal(true);
  readSort = signal<ReadSortOrder>('default');

  sortedEpisodes = computed(() => sortByRead(this.episodes(), this.readSort()));

  onSortChange(order: ReadSortOrder) {
    this.readSort.set(order);
  }

  ngOnInit() {
    this.seo.set({
      title: 'Java Minute',
      description: 'Short, sharp answers to tricky Java questions — one episode at a time.',
      path: '/java/java-minute',
    });

    this.javaMinuteService.listEpisodes().subscribe({
      next: (list) => { this.episodes.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
