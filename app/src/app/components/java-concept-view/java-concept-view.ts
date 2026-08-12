import { ChangeDetectionStrategy, Component, HostListener, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { JavaConcept } from '../../models/java-concept.model';
import { parseMarkdown } from '../../shared/markdown';
import { getReferenceIcon } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { RenderConceptVizDirective } from '../../directives/render-concept-viz.directive';
import { ConceptActions } from '../concept-actions/concept-actions';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-java-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, RenderConceptVizDirective, ConceptActions],
  templateUrl: './java-concept-view.html',
  styleUrl: './java-concept-view.css',
})
export class JavaConceptView implements OnChanges {
  concept = input<JavaConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);
  deepDives = signal<{ id: string; phrase: string; html: SafeHtml }[]>([]);
  activeDeepDiveId = signal<string | null>(null);

  referenceIcon = getReferenceIcon;

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const trigger = target?.closest('.deep-dive-trigger[data-deepdive-id]') as HTMLElement | null;
    if (!trigger) return;
    const id = trigger.dataset['deepdiveId'];
    if (!id) return;
    event.preventDefault();
    this.activeDeepDiveId.set(id);
  }

  closeDeepDive(): void {
    this.activeDeepDiveId.set(null);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['concept']) return;

    const concept = this.concept();
    if (!concept) {
      this.sections.set([]);
      this.deepDives.set([]);
      this.activeDeepDiveId.set(null);
      return;
    }

    const parsed = concept.sections
      .filter((section) => section.title !== DOCUMENTATION_LINKS_TITLE)
      .map((section) => ({ title: section.title, ...parseMarkdown(this.sanitizer, section.content) }));

    this.sections.set(parsed.map(({ title, html }) => ({ title, html })));
    this.deepDives.set(parsed.flatMap((section) => section.deepDives));
    this.activeDeepDiveId.set(null);
  }
}
