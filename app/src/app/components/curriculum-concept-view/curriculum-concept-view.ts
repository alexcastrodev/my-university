import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CurriculumConceptDetail } from '../../models/curriculum-concept.model';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptActions } from '../concept-actions/concept-actions';
import { BreadcrumbItem, Breadcrumbs } from '../breadcrumbs/breadcrumbs';
import { ConceptFeature, FEATURE_ROUTES } from '../../shared/concept-links';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';
const CURRICULUM_FEATURE_PREFIX = 'curriculum/';

interface CurriculumConceptLinkItem {
  label: string;
  route: string[] | null;
}

/** Resolves a `related` entry's route. No `feature` means "this same discipline" (the
 *  historical default, still used by same-discipline links, resolved against `basePath`).
 *  `curriculum/<module>/<discipline>` addresses a different CC discipline. Anything else is
 *  a Complementary Studies track name, resolved via `FEATURE_ROUTES` — a feature name this
 *  map doesn't recognize degrades to a plain-text label rather than a broken link. */
function resolveRoute(feature: string | undefined, slug: string, basePath: string): string[] | null {
  if (!feature) return [basePath, slug];

  if (feature.startsWith(CURRICULUM_FEATURE_PREFIX)) {
    const modulePath = feature.slice(CURRICULUM_FEATURE_PREFIX.length);
    return ['/computer-science', ...modulePath.split('/'), slug];
  }

  const route = FEATURE_ROUTES[feature as ConceptFeature];
  return route ? [route, slug] : null;
}

/** Generic concept view for any Computer Science module/discipline — the same shape as
 *  every other track's `*-concept-view` (jvm, database, ...), parameterized by `basePath`
 *  instead of a fixed route, since curriculum routes carry a module *and* a discipline
 *  segment. Related-concept links resolve same-discipline, cross-discipline (within CC), or
 *  into a Complementary Studies track, depending on `feature` — see `resolveRoute`. */
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
  fallbackNotice = input<boolean>(false);
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
          : { label: ref.label, route: resolveRoute(ref.feature, ref.slug, this.basePath()) },
      ),
    );
  }
}
