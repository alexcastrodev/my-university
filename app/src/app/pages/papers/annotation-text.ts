import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { renderNoteMarkdown } from '../../shared/safe-markdown';

/**
 * What a reader typed, shown. It goes through `renderNoteMarkdown` and is bound as a plain string, never as a
 * trusted one, so Angular's own sanitizer stands behind it.
 */
@Component({
  selector: 'app-annotation-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="text" [innerHTML]="html()"></div>`,
  styles: `
    .text { font-size: 0.92rem; line-height: 1.55; color: var(--mu-ink); overflow-wrap: anywhere; }
    .text :is(p, ul, ol, pre) { margin: 0 0 0.5rem; }
    .text :is(p, ul, ol, pre):last-child { margin-bottom: 0; }
    .text :is(ul, ol) { padding-left: 1.2rem; }
    .text code { padding: 0 0.25rem; font-size: 0.85em; background: var(--mu-bg-alt); border-radius: 4px; }
    .text pre { padding: 0.5rem; overflow-x: auto; background: var(--mu-bg-alt); border-radius: 6px; }
    .text a { color: var(--mu-accent-strong); }
  `,
})
export class AnnotationText {
  readonly text = input.required<string>();
  protected html = computed(() => renderNoteMarkdown(this.text()));
}
