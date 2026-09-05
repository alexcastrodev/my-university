import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CurriculumConceptDetail } from '../../models/curriculum-concept.model';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptActions } from '../concept-actions/concept-actions';
import { BreadcrumbItem, Breadcrumbs } from '../breadcrumbs/breadcrumbs';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

interface CurriculumConceptLinkItem {
  label: string;
  route: string[] | null;
}

/** Generic concept view for any Computer Science module/discipline — the same shape as
 *  every other track's `*-concept-view` (jvm, database, ...), parameterized by `basePath`
 *  instead of a fixed route, since curriculum routes carry a module *and* a discipline
 *  segment. Related-concept links resolve within `basePath` only — cross-module related
 *  links aren't supported yet (see tasks.md). */
@Component({
  selector: 'app-curriculum-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, ConceptActions, RouterLink, Breadcrumbs],
  templateUrl: './curriculum-concept-view.html',
})
export class CurriculumConceptView implements OnChanges {
  concept = input<CurriculumConceptDetail | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  breadcrumbs = input<BreadcrumbItem[]>([]);
  basePath = input.required<string>();
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);
  relatedItems = signal<CurriculumConceptLinkItem[]>([]);

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
    this.relatedItems.set(
      concept.related.map((ref) =>
        typeof ref === 'string'
          ? { label: ref, route: null }
          : { label: ref.label, route: [this.basePath(), ref.slug] },
      ),
    );
  }
}
