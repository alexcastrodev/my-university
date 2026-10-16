import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AwardHex } from '../award-hex/award-hex';

/** What a prize asks the user to finish; `needCount` says how many of them. A trophy asks for the same units as its badges together. */
export type Need = 'concepts' | 'lessons';

/**
 * One badge or trophy in the catalog, earned or not: its hexagon (grey until earned), what it takes, how
 * far the user is, its XP and its state. With `expandable`, the projected content (the list of what is
 * needed) opens under the row. State is always written, never only a colour.
 */
@Component({
  selector: 'app-prize-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardHex, DatePipe, NgTemplateOutlet],
  templateUrl: './prize-row.html',
  styleUrl: './prize-row.css',
})
export class PrizeRow {
  type = input.required<'badge' | 'trophy'>();
  iconSlug = input.required<string>();
  title = input.required<string>();
  need = input.required<Need>();
  needCount = input.required<number>();
  done = input.required<number>();
  total = input.required<number>();
  exp = input.required<number>();
  /** When it was earned; null while it has not been. */
  awardedAt = input<string | null>(null);
  /** The session ends in a knowledge check (self-reported, like every completion here). */
  assessed = input(false);
  /** Shows a toggle that reveals the projected list. */
  expandable = input(false);

  protected earned = computed(() => this.awardedAt() !== null);
  protected state = computed<'earned' | 'progress' | 'todo'>(() => (this.earned() ? 'earned' : this.done() > 0 ? 'progress' : 'todo'));
  protected percent = computed(() => (this.total() === 0 ? 0 : Math.round((this.done() / this.total()) * 100)));
  protected hex = computed(() => ({ type: this.type(), iconSlug: this.iconSlug() }));
}
