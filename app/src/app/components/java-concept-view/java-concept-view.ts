import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { JavaConcept } from '../../models/java-concept.model';
import { parseMarkdown } from '../../shared/markdown';
import { getReferenceIcon } from '../../shared/concept-sections';
import { ConceptLinkItem, toConceptLinkItem } from '../../shared/concept-links';
import { DeepDiveConceptView } from '../../shared/deep-dive-concept-view';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { RenderConceptVizDirective } from '../../directives/render-concept-viz.directive';
import { ConceptLabTab } from '../concept-lab-tab/concept-lab-tab';
import { ConceptActions } from '../concept-actions/concept-actions';
import { BreadcrumbItem, Breadcrumbs } from '../breadcrumbs/breadcrumbs';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-java-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, RenderConceptVizDirective, ConceptActions, ConceptLabTab, RouterLink, Breadcrumbs],
  templateUrl: './java-concept-view.html',
  styleUrl: './java-concept-view.css',
})
export class JavaConceptView extends DeepDiveConceptView implements OnChanges {
  concept = input<JavaConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  breadcrumbs = input<BreadcrumbItem[]>([]);
  fallbackNotice = input<boolean>(false);
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);
  relatedItems = signal<ConceptLinkItem[]>([]);

  labHtml = signal<SafeHtml | null>(null);
  tab = signal<'concept' | 'lab'>(
    inject(ActivatedRoute).snapshot.queryParamMap.get('tab') === 'lab' ? 'lab' : 'concept',
  );
  private location = inject(Location);

  /** Switches tab and keeps `?tab=lab` in the address bar so the Lab tab can be linked to. */
  selectTab(tab: 'concept' | 'lab'): void {
    this.tab.set(tab);
    const [path] = this.location.path().split(/[?#]/);
    this.location.replaceState(path, tab === 'lab' ? 'tab=lab' : '');
  }

  referenceIcon = getReferenceIcon;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['concept']) return;

    const concept = this.concept();
    if (!concept) {
      this.sections.set([]);
      this.labHtml.set(null);
      this.deepDives.set([]);
      this.activeDeepDiveId.set(null);
      this.relatedItems.set([]);
      return;
    }

    const parsed = concept.sections
      .filter((section) => section.title !== DOCUMENTATION_LINKS_TITLE)
      .map((section) => ({ title: section.title, ...parseMarkdown(this.sanitizer, section.content) }));

    this.sections.set(parsed.map(({ title, html }) => ({ title, html })));
    this.deepDives.set(parsed.flatMap((section) => section.deepDives));
    this.activeDeepDiveId.set(null);
    this.labHtml.set(concept.lab ? parseMarkdown(this.sanitizer, concept.lab).html : null);
    this.relatedItems.set(concept.related.map((ref) => toConceptLinkItem(ref, 'java-concepts')));
  }
}
