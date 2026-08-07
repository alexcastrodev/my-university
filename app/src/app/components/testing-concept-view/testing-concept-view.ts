import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TestingConcept } from '../../models/testing-concept.model';
import { AuthService } from '../../services/auth.service';
import { getReferenceIcon, mapConceptSections } from '../../shared/concept-sections';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-testing-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective],
  templateUrl: './testing-concept-view.html',
  styleUrl: './testing-concept-view.css',
})
export class TestingConceptView implements OnChanges {
  concept = input<TestingConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  protected auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

  referenceIcon = getReferenceIcon;

  onMarkRead(): void {
    if (!this.auth.currentUser() || this.read() || this.marking()) return;
    this.markRead.emit();
  }

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
