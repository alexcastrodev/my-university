import { Directive, HostListener, signal } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';

/** Base for any `*-concept-view` component that renders Deep Dive triggers
 *  (`{{phrase}}[^id]` markdown, see `parseMarkdown`). Owns the panel state — which
 *  dive is open, and the click delegation that opens one when its trigger span is
 *  clicked — so each concept view only wires up parsing its own concept shape. */
@Directive()
export abstract class DeepDiveConceptView {
  deepDives = signal<{ id: string; phrase: string; html: SafeHtml }[]>([]);
  activeDeepDiveId = signal<string | null>(null);

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
}
