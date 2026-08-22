import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { QuarkusConcept } from '../../models/quarkus-concept.model';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { ConceptLinkItem, toConceptLinkItem } from '../../shared/concept-links';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptActions } from '../concept-actions/concept-actions';
import { BreadcrumbItem, Breadcrumbs } from '../breadcrumbs/breadcrumbs';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-quarkus-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, ConceptActions, RouterLink, Breadcrumbs],
  templateUrl: './quarkus-concept-view.html',
})
export class QuarkusConceptView implements OnChanges {
  concept = input<QuarkusConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  breadcrumbs = input<BreadcrumbItem[]>([]);
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);
  relatedItems = signal<ConceptLinkItem[]>([]);

  referenceIcon = getReferenceIcon;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['concept']) return;

    const concept = this.concept();
    if (!concept) {
      this.sections.set([]);
      this.relatedItems.set([]);
      return;
    }

    this.sections.set(mapConceptSections(concept.sections, DOCUMENTATION_LINKS_TITLE, this.sanitizer));
    this.relatedItems.set(concept.related.map((ref) => toConceptLinkItem(ref, 'quarkus-concepts')));
  }
}
