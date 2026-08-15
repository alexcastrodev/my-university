import { ChangeDetectionStrategy, Component, HostListener, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { JvmConcept } from '../../models/jvm-concept.model';
import { parseMarkdown } from '../../shared/markdown';
import { getReferenceIcon } from '../../shared/concept-sections';
import { ConceptLinkItem, toConceptLinkItem } from '../../shared/concept-links';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';
import { ConceptActions } from '../concept-actions/concept-actions';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-jvm-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective, ConceptActions, RouterLink],
  templateUrl: './jvm-concept-view.html',
})
export class JvmConceptView implements OnChanges {
  concept = input<JvmConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);
  deepDives = signal<{ id: string; phrase: string; html: SafeHtml }[]>([]);
  activeDeepDiveId = signal<string | null>(null);
  relatedItems = signal<ConceptLinkItem[]>([]);

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
      this.relatedItems.set([]);
      return;
    }

    const parsed = concept.sections
      .filter((section) => section.title !== DOCUMENTATION_LINKS_TITLE)
      .map((section) => ({ title: section.title, ...parseMarkdown(this.sanitizer, section.content) }));

    this.sections.set(parsed.map(({ title, html }) => ({ title, html })));
    this.deepDives.set(parsed.flatMap((section) => section.deepDives));
    this.activeDeepDiveId.set(null);
    this.relatedItems.set(concept.related.map((ref) => toConceptLinkItem(ref, 'jvm-concepts')));
  }
}
