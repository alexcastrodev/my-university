import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { JavaMinuteEpisode } from '../../models/java-minute.model';
import { AuthService } from '../../services/auth.service';
import { parseMarkdown } from '../../shared/markdown';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';

const REFERENCES_TITLE = 'References';

@Component({
  selector: 'app-java-minute-episode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective],
  templateUrl: './java-minute-episode.html',
  styleUrl: './java-minute-episode.css',
})
export class JavaMinuteEpisodeView implements OnChanges {
  episode = input<JavaMinuteEpisode | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  protected auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

  referenceIcon(type: 'video' | 'doc'): string {
    return type === 'video' ? '🎬' : '📄';
  }

  onMarkRead(): void {
    if (!this.auth.currentUser() || this.read() || this.marking()) return;
    this.markRead.emit();
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
