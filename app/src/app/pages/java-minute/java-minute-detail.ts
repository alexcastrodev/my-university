import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JavaMinuteEpisodeView } from '../../components/java-minute-episode/java-minute-episode';
import { JavaMinuteEpisode } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';
import { SeoService } from '../../services/seo.service';

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
  private seo = inject(SeoService);

  episode = signal<JavaMinuteEpisode | null>(null);
  loading = signal(true);
  notFound = signal(false);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.javaMinuteService.getEpisode(slug).subscribe({
      next: (episode) => {
        this.episode.set(episode);
        this.loading.set(false);
        this.seo.set({
          title: `${episode.question} — Java Minute`,
          description: this.summarize(episode),
          path: `/java-minute/${episode.slug}`,
          type: 'article',
        });
      },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }

  private summarize(episode: JavaMinuteEpisode): string {
    const shortAnswer = episode.sections.find((s) => s.title === 'Short Answer');
    const text = shortAnswer?.content ?? episode.question;
    const plain = text.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > 200 ? `${plain.slice(0, 197)}...` : plain;
  }
}
