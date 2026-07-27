import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { JavaMinuteEpisodeView } from '../../components/java-minute-episode/java-minute-episode';
import { JavaMinuteEpisode } from '../../models/java-minute.model';
import { JavaMinuteService } from '../../services/java-minute.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

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
  private xpService = inject(XpService);

  episode = signal<JavaMinuteEpisode | null>(null);
  loading = signal(true);
  notFound = signal(false);
  read = signal(false);
  marking = signal(false);

  private slug = '';

  ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.javaMinuteService.getEpisode(this.slug).subscribe({
      next: (episode) => {
        this.episode.set(episode);
        this.read.set(episode.read);
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

  onMarkRead(): void {
    if (this.read() || this.marking()) return;
    this.marking.set(true);
    this.javaMinuteService.markRead(this.slug).subscribe({
      next: () => {
        this.read.set(true);
        this.marking.set(false);
        this.xpService.loadSummary();
      },
      error: () => this.marking.set(false),
    });
  }

  private summarize(episode: JavaMinuteEpisode): string {
    const shortAnswer = episode.sections.find((s) => s.title === 'Short Answer');
    const text = shortAnswer?.content ?? episode.question;
    const plain = text.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > 200 ? `${plain.slice(0, 197)}...` : plain;
  }
}
