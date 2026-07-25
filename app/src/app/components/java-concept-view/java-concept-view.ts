import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { JavaConcept } from '../../models/java-concept.model';
import { parseMarkdown } from '../../shared/markdown';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-java-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './java-concept-view.html',
  styleUrl: './java-concept-view.css',
})
export class JavaConceptView implements OnChanges {
  concept = input<JavaConcept | null>(null);

  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

  referenceIcon(type: 'video' | 'doc'): string {
    return type === 'video' ? '🎬' : '📄';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['concept']) return;

    const concept = this.concept();
    if (!concept) {
      this.sections.set([]);
      return;
    }

    this.sections.set(
      concept.sections
        .filter((section) => section.title !== DOCUMENTATION_LINKS_TITLE)
        .map((section) => ({ title: section.title, html: parseMarkdown(this.sanitizer, section.content) })),
    );
  }
}
