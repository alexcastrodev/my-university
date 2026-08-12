import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DatabaseConcept } from '../../models/database-concept.model';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptActions } from '../concept-actions/concept-actions';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-database-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, ConceptActions],
  templateUrl: './database-concept-view.html',
  styleUrl: './database-concept-view.css',
})
export class DatabaseConceptView implements OnChanges {
  concept = input<DatabaseConcept | null>(null);
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
