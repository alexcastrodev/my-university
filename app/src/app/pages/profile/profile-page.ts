import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AwardsSections } from '../../components/awards-sections/awards-sections';
import { ProfileHeader } from '../../components/profile-header/profile-header';
import { SourceLabel } from '../../components/source-label/source-label';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { publicProfileUrl } from '../../shared/public-profile-url';
import { buildBreakdownRows } from '../../shared/xp-breakdown';

/**
 * The owner's own profile: the same view a visitor gets at `/u/<id>` (header, awards), plus what only
 * the owner can do or see: rename, choose who can see it, level progress, streak and the daily goal.
 * XP breakdown and the activity list live on their own page (`/profile/activity`).
 */
@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AwardsSections, ProfileHeader, RouterLink, SourceLabel],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePage implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);

  progressPercent = computed(() => {
    const summary = this.xpService.summary();
    if (!summary) return 0;
    const { level, total } = summary;
    if (level.nextLevelXp === null) return 100;
    const span = level.nextLevelXp - level.minXp;
    if (span <= 0) return 100;
    return Math.min(100, Math.round(((total - level.minXp) / span) * 100));
  });

  dailyGoalPercent = computed(() => {
    const goal = this.xpService.dailyGoal();
    if (!goal || goal.goal <= 0) return 0;
    return Math.min(100, Math.round((goal.earnedToday / goal.goal) * 100));
  });

  private awards = computed(() => this.xpService.achievements()?.awards ?? []);
  badges = computed(() => this.awards().filter((a) => a.type === 'badge'));
  trophies = computed(() => this.awards().filter((a) => a.type === 'trophy'));

  /** The kind of activity with the most XP earned: the topic the user has engaged with the most. */
  favoriteTopic = computed(() => {
    const top = buildBreakdownRows(this.xpService.summary(), this.xpService.areas())[0];
    return top ? { label: top.label, total: top.total } : null;
  });

  // Editing the name, and who can see the profile.
  editing = signal(false);
  draft = signal('');
  saving = signal(false);
  message = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  copied = signal(false);

  /** On unless the server says otherwise: public profiles are the default. */
  isPublic = computed(() => this.auth.currentUser()?.profilePublic !== false);
  publicId = computed(() => (this.isPublic() ? (this.auth.currentUser()?.publicProfileId ?? null) : null));

  ngOnInit(): void {
    if (!this.auth.currentUser()) return;
    this.xpService.loadSummary();
    this.xpService.loadStreak();
    this.xpService.loadDailyGoal();
    this.xpService.loadAreas();
    void this.xpService.syncAchievements(false);
  }

  startEdit(): void {
    this.draft.set(this.auth.currentUser()?.displayName ?? '');
    this.message.set(null);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  save(): void {
    this.submitName(this.draft());
  }

  resetToGithubName(): void {
    this.submitName(null);
  }

  setPublic(profilePublic: boolean): void {
    if (profilePublic === this.isPublic() || this.saving()) return;
    this.saving.set(true);
    this.message.set(null);
    this.auth.updateProfilePublic(profilePublic).subscribe({
      next: () => this.finish({ kind: 'success', text: $localize`:@@settings.saved:Saved.` }),
      error: () => this.finish({ kind: 'error', text: $localize`:@@settings.error:Something went wrong. Try again.` }),
    });
  }

  async copyLink(): Promise<void> {
    const id = this.publicId();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(publicProfileUrl(id));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard access can be denied: the link is one click away on the public page.
    }
  }

  private submitName(displayName: string | null): void {
    this.saving.set(true);
    this.message.set(null);
    this.auth.updateDisplayName(displayName).subscribe({
      next: () => {
        this.editing.set(false);
        this.finish({ kind: 'success', text: $localize`:@@settings.saved:Saved.` });
      },
      error: () => this.finish({ kind: 'error', text: $localize`:@@settings.error:Something went wrong. Try again.` }),
    });
  }

  private finish(message: { kind: 'success' | 'error'; text: string }): void {
    this.saving.set(false);
    this.message.set(message);
  }
}
