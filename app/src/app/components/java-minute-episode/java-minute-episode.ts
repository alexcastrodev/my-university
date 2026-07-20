import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { JavaMinuteEpisode } from '../../models/java-minute.model';
import { parseMarkdown } from '../../shared/markdown';

const REFERENCES_TITLE = 'Referências';

@Component({
  selector: 'app-java-minute-episode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './java-minute-episode.html',
  styleUrl: './java-minute-episode.css',
})
export class JavaMinuteEpisodeView implements OnChanges {
  episode = input<JavaMinuteEpisode | null>(null);

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

  referenceIcon(type: 'video' | 'doc'): string {
    return type === 'video' ? '🎬' : '📄';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['episode']) return;

    const episode = this.episode();
    if (!episode) {
      this.sections.set([]);
      return;
    }

    this.sections.set(
      episode.sections
        .filter((section) => section.title !== REFERENCES_TITLE)
        .map((section) => ({ title: section.title, html: parseMarkdown(this.sanitizer, section.content) })),
    );
  }
}
