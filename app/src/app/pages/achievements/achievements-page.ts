import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AchievementCatalog } from '../../components/achievement-catalog/achievement-catalog';
import { AwardsSections } from '../../components/awards-sections/awards-sections';
import { TrackIcon } from '../../components/track-icon/track-icon';
import { TrackProgressView } from '../../models/achievements.model';
import { XpService } from '../../services/xp.service';

/**
 * The Achievements tab of the profile, in two views: "Earned" (the tracks still in progress, then every
 * trophy and badge earned) and "Available" (everything that can be earned and what it takes, picked with
 * `?view=available`). Reading only: nothing here ever locks content.
 */
@Component({
  selector: 'app-achievements-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AchievementCatalog, AwardsSections, RouterLink, TrackIcon],
  templateUrl: './achievements-page.html',
  styleUrl: './achievements-page.css',
})
export class AchievementsPage implements OnInit {
  protected xp = inject(XpService);

  /** Bound from the `view` query parameter (the router passes it in); anything but `available` means "Earned". */
  view = input<string | undefined>(undefined);
  protected available = computed(() => this.view() === 'available');
  /** Bound from `?award=<id>`: the award a link (the "badge earned" dialog, a concept's sidebar) points at. */
  award = input<string | undefined>(undefined);

  protected loading = signal(true);

  private awards = computed(() => this.xp.achievements()?.awards ?? []);
  protected badges = computed(() => this.awards().filter((a) => a.type === 'badge'));
  protected trophies = computed(() => this.awards().filter((a) => a.type === 'trophy'));

  /** Tracks the user started and has not finished with nothing new waiting, or that grew after being finished. */
  protected inProgress = computed<TrackProgressView[]>(() =>
    (this.xp.achievements()?.progress ?? []).filter((t) => (t.done > 0 && !t.awarded) || t.newSinceAward > 0),
  );

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    await this.xp.syncAchievements(false);
    this.loading.set(false);
  }

  protected percent(track: TrackProgressView): number {
    return track.total === 0 ? 0 : Math.round((track.done / track.total) * 100);
  }
}
