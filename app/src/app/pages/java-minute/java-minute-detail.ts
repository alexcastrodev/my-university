import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JavaMinuteEpisodeView } from '../../components/java-minute-episode/java-minute-episode';
import { JavaMinuteEpisode } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';

@Component({
  selector: 'app-java-minute-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JavaMinuteEpisodeView, RouterLink],
  templateUrl: './java-minute-detail.html',
  styleUrl: './java-minute-detail.css',
})
export class JavaMinuteDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private javaMinuteService = inject(JavaMinuteService);

  episode = signal<JavaMinuteEpisode | null>(null);
  loading = signal(true);
  notFound = signal(false);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.javaMinuteService.getEpisode(slug).subscribe({
      next: (episode) => { this.episode.set(episode); this.loading.set(false); },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }
}
