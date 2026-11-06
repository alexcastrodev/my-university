import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AwardsSections } from '../../components/awards-sections/awards-sections';
import { PublicProfilePage } from './public-profile-page';

/** The Overview tab of a public profile: its badges and trophies, read from the profile the shell loaded. */
@Component({
  selector: 'app-public-profile-awards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardsSections],
  template: `
    @if (page.profile(); as profile) {
      <app-awards-sections [trophies]="profile.trophies" [badges]="profile.badges" />

      @if (profile.badges.length === 0 && profile.trophies.length === 0) {
        <p class="state" i18n="@@publicProfile.empty">No badges or trophies yet.</p>
      }
    }
  `,
  styles: `.state { color: var(--mu-muted); font-size: 0.9rem; margin: 0; }`,
})
export class PublicProfileAwards {
  protected page = inject(PublicProfilePage);
}
