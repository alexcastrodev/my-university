import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../../models/language.model';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { ThemeService } from '../../services/theme.service';
import { profileKey, publicProfileUrl } from '../../shared/public-profile-url';
import { XpService } from '../../services/xp.service';

/**
 * Account, language and theme in one place. On phones this is the fifth bottom-nav tab and
 * replaces the header entirely, so it also carries what only the header offered there: the
 * account links, logout, the language switcher and the Complementary Studies menu.
 */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  protected auth = inject(AuthService);
  protected themeService = inject(ThemeService);
  protected languageService = inject(LanguageService);
  protected xpService = inject(XpService);
  private router = inject(Router);

  protected readonly languages = SUPPORTED_LANGUAGES;
  protected readonly LANGUAGE_LABELS = LANGUAGE_LABELS;

  protected readonly initials = computed(() =>
    (this.auth.currentUser()?.displayName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join(''),
  );

  /** On unless the server says otherwise: public profiles are the default. */
  protected readonly isPublic = computed(() => this.auth.currentUser()?.profilePublic !== false);
  protected readonly profileLink = computed(() => {
    const key = profileKey(this.auth.currentUser());
    return this.isPublic() && key ? publicProfileUrl(key) : null;
  });
  profileSaving = signal(false);
  profileMessage = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  copied = signal(false);

  displayName = signal(this.auth.currentUser()?.displayName ?? '');
  saving = signal(false);
  message = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  save(): void {
    this.submit(this.displayName());
  }

  resetToGithubName(): void {
    this.submit(null);
  }

  setProfilePublic(profilePublic: boolean): void {
    if (profilePublic === this.isPublic() || this.profileSaving()) return;
    this.profileSaving.set(true);
    this.profileMessage.set(null);
    this.auth.updateProfilePublic(profilePublic).subscribe({
      next: () => {
        this.profileSaving.set(false);
        this.profileMessage.set({ kind: 'success', text: $localize`:@@settings.saved:Saved.` });
      },
      error: () => {
        this.profileSaving.set(false);
        this.profileMessage.set({ kind: 'error', text: $localize`:@@settings.error:Something went wrong. Try again.` });
      },
    });
  }

  async copyProfileLink(): Promise<void> {
    const link = this.profileLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard access can be denied: the link stays on screen to copy by hand.
    }
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }

  private submit(displayName: string | null): void {
    this.saving.set(true);
    this.message.set(null);
    this.auth.updateDisplayName(displayName).subscribe({
      next: (user) => {
        this.displayName.set(user.displayName);
        this.saving.set(false);
        this.message.set({ kind: 'success', text: $localize`:@@settings.saved:Saved.` });
      },
      error: () => {
        this.saving.set(false);
        this.message.set({ kind: 'error', text: $localize`:@@settings.error:Something went wrong. Try again.` });
      },
    });
  }
}
