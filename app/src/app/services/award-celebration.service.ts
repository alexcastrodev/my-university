import { Injectable, signal } from '@angular/core';
import { AwardView } from '../models/achievements.model';

/**
 * Awards waiting to be celebrated. A toast is easy to miss, and earning a badge is rare, so it gets a
 * dialog of its own (`app-award-celebration`) that stays until the user closes it.
 */
@Injectable({ providedIn: 'root' })
export class AwardCelebrationService {
  /** Everything earned since the dialog was last closed; badge and trophy of one action show together. */
  pending = signal<AwardView[]>([]);

  show(award: AwardView): void {
    this.pending.update((awards) => [...awards, award]);
  }

  dismiss(): void {
    this.pending.set([]);
  }
}
