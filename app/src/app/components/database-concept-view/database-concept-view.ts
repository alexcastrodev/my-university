import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DatabaseConcept } from '../../models/database-concept.model';
import { AuthService } from '../../services/auth.service';
import { parseMarkdown } from '../../shared/markdown';
import { RenderMermaidDirective } from '../../directives/render-mermaid.directive';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-database-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RenderMermaidDirective],
  templateUrl: './database-concept-view.html',
  styleUrl: './database-concept-view.css',
})
export class DatabaseConceptView implements OnChanges {
  concept = input<DatabaseConcept | null>(null);
  read = input<boolean>(false);
  marking = input<boolean>(false);
  markRead = output<void>();

  protected auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);
  sections = signal<{ title: string; html: SafeHtml }[]>([]);

  referenceIcon(type: 'video' | 'doc'): string {
    return type === 'video' ? '🎬' : '📄';
  }

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

    this.sections.set(
      concept.sections
        .filter((section) => section.title !== DOCUMENTATION_LINKS_TITLE)
        .map((section) => ({ title: section.title, html: parseMarkdown(this.sanitizer, section.content) })),
    );
  }
}
