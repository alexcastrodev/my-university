import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AwardView } from '../../models/achievements.model';
import { AwardTile } from '../award-tile/award-tile';

/** Trophies, then badges, each as a titled grid of compact award tiles; a group with nothing in it is not drawn. */
@Component({
  selector: 'app-awards-sections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardTile],
  templateUrl: './awards-sections.html',
  styleUrl: './awards-sections.css',
})
export class AwardsSections {
  trophies = input<AwardView[]>([]);
  badges = input<AwardView[]>([]);
  /** Id of the award to ring and scroll to, if any. */
  highlight = input<string | null>(null);
}
