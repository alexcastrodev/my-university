import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SpringConcept } from '../../models/spring-concept.model';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptActions } from '../concept-actions/concept-actions';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-spring-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, ConceptActions],
  templateUrl: './spring-concept-view.html',
  styleUrl: './spring-concept-view.css',
})
export class SpringConceptView implements OnChanges {
  concept = input<SpringConcept | null>(null);
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
