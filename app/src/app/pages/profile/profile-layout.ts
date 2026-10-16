import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LevelProgress, ProfileBanner } from '../../components/profile-banner/profile-banner';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { publicProfileUrl } from '../../shared/public-profile-url';

/**
 * The owner's profile shell: the banner, one "Edit profile" button that opens a panel (name, who can
 * see it, the link), and the tabs. Overview, Achievements and Activity render inside it, so they share
 * one banner and the page stays short.
 */
@Component({
  selector: 'app-profile-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileBanner, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './profile-layout.html',
  styleUrl: './profile-layout.css',
})
export class ProfileLayout implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);

  /** Newest first, trophies and badges together: the banner strip shows the first few. */
  protected awards = computed(() => this.xpService.achievements()?.awards ?? []);
  protected badgeCount = computed(() => this.awards().filter((a) => a.type === 'badge').length);
  protected trophyCount = computed(() => this.awards().filter((a) => a.type === 'trophy').length);

  /** How far the user is to the next level, for the bar in the banner. */
  protected levelProgress = computed<LevelProgress | null>(() => {
    const summary = this.xpService.summary();
    if (!summary) return null;
    const { level, total } = summary;
    if (level.nextLevelXp === null) return { percent: 100, remaining: null };
    const span = level.nextLevelXp - level.minXp;
    const percent = span <= 0 ? 100 : Math.min(100, Math.round(((total - level.minXp) / span) * 100));
    return { percent, remaining: level.nextLevelXp - total };
  });

  // The edit panel: the name, and who can see the profile.
  protected editing = signal(false);
  protected draft = signal('');
  protected saving = signal(false);
  protected message = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  protected copied = signal(false);

  /** On unless the server says otherwise: public profiles are the default. */
  protected isPublic = computed(() => this.auth.currentUser()?.profilePublic !== false);
  protected publicId = computed(() => (this.isPublic() ? (this.auth.currentUser()?.publicProfileId ?? null) : null));
  protected profileLink = computed(() => {
    const id = this.publicId();
    return id ? publicProfileUrl(id) : null;
  });

  ngOnInit(): void {
    if (!this.auth.currentUser()) return;
    this.xpService.loadSummary();
    this.xpService.loadStreak();
    this.xpService.loadDailyGoal();
    this.xpService.loadAreas();
    void this.xpService.syncAchievements(false);
  }

  protected toggleEditing(): void {
    if (!this.editing()) {
      this.draft.set(this.auth.currentUser()?.displayName ?? '');
      this.message.set(null);
    }
    this.editing.update((open) => !open);
  }

  protected saveName(): void {
    this.submitName(this.draft());
  }

  protected resetToGithubName(): void {
    this.submitName(null);
  }

  protected setPublic(profilePublic: boolean): void {
    if (profilePublic === this.isPublic() || this.saving()) return;
    this.saving.set(true);
    this.message.set(null);
    this.auth.updateProfilePublic(profilePublic).subscribe({
      next: () => this.finish({ kind: 'success', text: $localize`:@@settings.saved:Saved.` }),
      error: () => this.finish({ kind: 'error', text: $localize`:@@settings.error:Something went wrong. Try again.` }),
    });
  }

  protected async copyLink(): Promise<void> {
    const link = this.profileLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard access can be denied: the link stays in the field to copy by hand.
    }
  }

  private submitName(displayName: string | null): void {
    this.saving.set(true);
    this.message.set(null);
    this.auth.updateDisplayName(displayName).subscribe({
      next: (user) => {
        this.draft.set(user.displayName);
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
