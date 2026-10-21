import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AwardView } from '../../models/achievements.model';
import { TrackIcon } from '../track-icon/track-icon';

/**
 * The hexagon of an award: blue with its track's icon for a badge, gold with a cup for a trophy. `locked`
 * dims it to grey for a prize not earned yet (the catalog); it only changes the look, nothing is gated.
 */
@Component({
  selector: 'app-award-hex',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TrackIcon],
  template: `<span class="hex" [class.hex-trophy]="trophy()" [class.hex-small]="size() === 'small'" [class.hex-large]="size() === 'large'" [class.hex-locked]="locked()" aria-hidden="true"><app-track-icon [slug]="slug()" /></span>`,
  styleUrl: './award-hex.css',
})
export class AwardHex {
  /** Only the kind and the track icon matter, so the catalog can draw prizes that are not awards yet. */
  award = input.required<Pick<AwardView, 'type' | 'iconSlug'>>();
  size = input<'normal' | 'small' | 'large'>('normal');
  locked = input(false);

  protected trophy = computed(() => this.award().type === 'trophy');
  protected slug = computed(() => (this.trophy() ? 'trophy' : this.award().iconSlug));
}
