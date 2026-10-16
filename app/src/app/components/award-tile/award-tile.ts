import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AwardView } from '../../models/achievements.model';
import { AwardHex } from '../award-hex/award-hex';

/** One badge or trophy on a single compact row: a hexagon, its title, where and when it was earned, and its XP. */
@Component({
  selector: 'app-award-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardHex, DatePipe],
  templateUrl: './award-tile.html',
  styleUrl: './award-tile.css',
})
export class AwardTile {
  award = input.required<AwardView>();
}
