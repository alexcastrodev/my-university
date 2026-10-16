import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** How far the user is towards the next level; `remaining` is null at the top level. */
export interface LevelProgress {
  percent: number;
  remaining: number | null;
}

/**
 * The head of a profile, a flat band that follows the theme: avatar, name, level and the numbers that
 * matter. Achievements are not drawn here: a bare icon says nothing, so they always show as cards with
 * context (title, track, date, XP). The owner's profile and the public one render it, so they cannot
 * drift apart. Two slots: `[actions]` goes under the level (the owner's buttons) and `[tabs]` sits
 * at the bottom edge of the band. The level bar, the streak and the handle are optional because a visitor
 * does not get them.
 */
@Component({
  selector: 'app-profile-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-banner.html',
  styleUrl: './profile-banner.css',
})
export class ProfileBanner {
  avatarUrl = input.required<string>();
  displayName = input.required<string>();
  /** The GitHub login, shown only to the owner. */
  handle = input<string | null>(null);
  /** Shown as a small chip next to the name; null hides it (a visitor only ever sees public profiles). */
  visibility = input<'public' | 'private' | null>(null);
  level = input<{ number: number; title: string } | null>(null);
  levelProgress = input<LevelProgress | null>(null);
  xp = input<number | null>(null);
  badgeCount = input(0);
  trophyCount = input(0);
  streak = input<number | null>(null);
}
