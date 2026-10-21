import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AwardCelebrationService } from '../../services/award-celebration.service';
import { AwardHex } from '../award-hex/award-hex';

/**
 * The moment a badge or trophy is earned: a modal that names the prize, shows its XP and links to where it
 * now lives (the Achievements tab, with the new award highlighted). It stays until closed, so it cannot be
 * missed the way a toast can. Native `<dialog>`: Esc and the backdrop close it, focus is trapped inside.
 */
@Component({
  selector: 'app-award-celebration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardHex, RouterLink],
  templateUrl: './award-celebration.html',
  styleUrl: './award-celebration.css',
})
export class AwardCelebration {
  protected celebration = inject(AwardCelebrationService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected awards = computed(() => this.celebration.pending());
  protected onlyTrophies = computed(() => this.awards().every((a) => a.type === 'trophy'));
  /** The badge is the thing just finished, so it is the one highlighted; a lone trophy otherwise. */
  protected highlightId = computed(() => (this.awards().find((a) => a.type === 'badge') ?? this.awards()[0])?.id ?? null);

  constructor() {
    // Browser only: afterRenderEffect never runs during SSR, where `showModal` does not exist.
    afterRenderEffect(() => {
      const dialog = this.dialog().nativeElement;
      const open = this.awards().length > 0;
      if (open && !dialog.open) dialog.showModal();
      else if (!open && dialog.open) dialog.close();
    });
  }

  protected close(): void {
    this.celebration.dismiss();
  }

  /** A click on the backdrop lands on the dialog element itself, never on its content. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}
