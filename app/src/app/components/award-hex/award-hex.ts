import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AwardView } from '../../models/achievements.model';
import { TrackIcon } from '../track-icon/track-icon';

/** The hexagon of an award: blue with its track's icon for a badge, gold with a cup for a trophy. */
@Component({
  selector: 'app-award-hex',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TrackIcon],
  template: `<span class="hex" [class.hex-trophy]="trophy()" [class.hex-small]="size() === 'small'" aria-hidden="true"><app-track-icon [slug]="slug()" /></span>`,
  styleUrl: './award-hex.css',
})
export class AwardHex {
  award = input.required<AwardView>();
  size = input<'normal' | 'small'>('normal');

  protected trophy = computed(() => this.award().type === 'trophy');
  protected slug = computed(() => (this.trophy() ? 'trophy' : this.award().iconSlug));
}
