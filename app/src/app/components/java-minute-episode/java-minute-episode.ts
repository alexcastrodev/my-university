import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { JavaMinuteEpisode } from '../../models/java-minute.model';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptActions } from '../concept-actions/concept-actions';

const REFERENCES_TITLE = 'References';

@Component({
  selector: 'app-java-minute-episode',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, ConceptActions],
  templateUrl: './java-minute-episode.html',
  styleUrl: './java-minute-episode.css',
})
export class JavaMinuteEpisodeView implements OnChanges {
  episode = input<JavaMinuteEpisode | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

  referenceIcon = getReferenceIcon;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['episode']) return;

    const episode = this.episode();
    if (!episode) {
      this.sections.set([]);
      return;
    }

    this.sections.set(mapConceptSections(episode.sections, REFERENCES_TITLE, this.sanitizer));
  }
}
