import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TestingConcept } from '../../models/testing-concept.model';
import { parseMarkdown } from '../../shared/markdown';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptLabTab } from '../concept-lab-tab/concept-lab-tab';
import { ConceptActions } from '../concept-actions/concept-actions';
import { BreadcrumbItem, Breadcrumbs } from '../breadcrumbs/breadcrumbs';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-testing-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, ConceptActions, ConceptLabTab, Breadcrumbs],
  templateUrl: './testing-concept-view.html',
  styleUrl: './testing-concept-view.css',
})
export class TestingConceptView implements OnChanges {
  concept = input<TestingConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  breadcrumbs = input<BreadcrumbItem[]>([]);
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

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
      return;
    }

    this.sections.set(mapConceptSections(concept.sections, DOCUMENTATION_LINKS_TITLE, this.sanitizer));
    this.labHtml.set(concept.lab ? parseMarkdown(this.sanitizer, concept.lab).html : null);
  }
}
