import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AwardView } from '../../models/achievements.model';
import { TrackIcon } from '../track-icon/track-icon';

/** One badge or trophy: a hexagon with an icon, its title, when it was earned and how much XP it paid. */
@Component({
  selector: 'app-award-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TrackIcon],
  templateUrl: './award-card.html',
  styleUrl: './award-card.css',
})
export class AwardCard {
  award = input.required<AwardView>();
}
