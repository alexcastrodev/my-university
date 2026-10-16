import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The identity block of a profile: avatar, name, level, XP and the badge and trophy counters. The public
 * page and the owner's own profile both render it, so they cannot drift apart; whatever the page projects
 * (the owner's edit and visibility controls) goes under the name.
 */
@Component({
  selector: 'app-profile-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-header.html',
  styleUrl: './profile-header.css',
})
export class ProfileHeader {
  avatarUrl = input.required<string>();
  displayName = input.required<string>();
  level = input<{ number: number; title: string } | null>(null);
  xp = input<number | null>(null);
  badgeCount = input(0);
  trophyCount = input(0);
}
