import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AwardView } from '../../models/achievements.model';
import { AwardCard } from '../award-card/award-card';

/** Trophies, then badges, each as a titled grid of award cards; a group with nothing in it is not drawn. */
@Component({
  selector: 'app-awards-sections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardCard],
  templateUrl: './awards-sections.html',
  styleUrl: './awards-sections.css',
})
export class AwardsSections {
  trophies = input<AwardView[]>([]);
  badges = input<AwardView[]>([]);
}
