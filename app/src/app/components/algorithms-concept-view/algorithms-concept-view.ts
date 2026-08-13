import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RenderConceptVizDirective } from '../../directives/render-concept-viz.directive';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { AlgorithmsConcept } from '../../models/algorithms-concept.model';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { ConceptActions } from '../concept-actions/concept-actions';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-algorithms-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, RenderConceptVizDirective, ConceptActions],
  templateUrl: './algorithms-concept-view.html',
})
export class AlgorithmsConceptView implements OnChanges {
  concept = input<AlgorithmsConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

  referenceIcon = getReferenceIcon;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['concept']) return;

    const concept = this.concept();
    if (!concept) {
      this.sections.set([]);
      return;
    }

    this.sections.set(mapConceptSections(concept.sections, DOCUMENTATION_LINKS_TITLE, this.sanitizer));
  }
}
