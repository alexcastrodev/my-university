import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AwardCard } from '../../components/award-card/award-card';
import { TrackIcon } from '../../components/track-icon/track-icon';
import { AwardType, TrackProgressView } from '../../models/achievements.model';
import { AuthService } from '../../services/auth.service';
import { publicProfileUrl } from '../../shared/public-profile-url';
import { XpService } from '../../services/xp.service';

/** Badges and trophies earned, plus the tracks still in progress. Reading only: nothing here ever locks content. */
@Component({
  selector: 'app-achievements-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardCard, RouterLink, TrackIcon],
  templateUrl: './achievements-page.html',
  styleUrl: './achievements-page.css',
})
export class AchievementsPage implements OnInit {
  protected auth = inject(AuthService);
  protected xp = inject(XpService);

  protected tab = signal<AwardType>('badge');
  protected loading = signal(true);
  protected copied = signal(false);

  /** The id of the user's public profile, or null when it is private (or unknown for a stale cached user). */
  protected publicId = computed(() => {
    const user = this.auth.currentUser();
    return user && user.profilePublic !== false ? (user.publicProfileId ?? null) : null;
  });

  private awards = computed(() => this.xp.achievements()?.awards ?? []);
  protected badges = computed(() => this.awards().filter((a) => a.type === 'badge'));
  protected trophies = computed(() => this.awards().filter((a) => a.type === 'trophy'));
  protected shown = computed(() => (this.tab() === 'badge' ? this.badges() : this.trophies()));

  /** Tracks the user started and has not finished with nothing new waiting, or that grew after being finished. */
  protected inProgress = computed<TrackProgressView[]>(() =>
    (this.xp.achievements()?.progress ?? []).filter((t) => (t.done > 0 && !t.awarded) || t.newSinceAward > 0),
  );

  ngOnInit(): void {
    if (this.auth.currentUser()) void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    await this.xp.syncAchievements(false);
    this.loading.set(false);
  }

  protected async copyLink(): Promise<void> {
    const id = this.publicId();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(publicProfileUrl(id));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard access can be denied (insecure context, permissions): the link stays visible to copy by hand.
    }
  }

  protected select(type: AwardType): void {
    this.tab.set(type);
  }

  protected percent(track: TrackProgressView): number {
    return track.total === 0 ? 0 : Math.round((track.done / track.total) * 100);
  }
}
