import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JavaMinuteEpisodeSummary } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';

@Component({
  selector: 'app-java-minute-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './java-minute-list.html',
  styleUrl: './java-minute-list.css',
})
export class JavaMinuteListPage implements OnInit {
  private javaMinuteService = inject(JavaMinuteService);

  episodes = signal<JavaMinuteEpisodeSummary[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.javaMinuteService.listEpisodes().subscribe({
      next: (list) => { this.episodes.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
