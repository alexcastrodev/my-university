import { ChangeDetectionStrategy, Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SpringConcept } from '../../models/spring-concept.model';
import { AuthService } from '../../services/auth.service';
import { parseMarkdown } from '../../shared/markdown';

const DOCUMENTATION_LINKS_TITLE = 'Documentation Links';

@Component({
  selector: 'app-spring-concept-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spring-concept-view.html',
  styleUrl: './spring-concept-view.css',
})
export class SpringConceptView implements OnChanges {
  concept = input<SpringConcept | null>(null);
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
