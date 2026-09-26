import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../../models/language.model';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { ThemeService } from '../../services/theme.service';
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

  displayName = signal(this.auth.currentUser()?.displayName ?? '');
  saving = signal(false);
  message = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  save(): void {
    this.submit(this.displayName());
  }

  resetToGithubName(): void {
    this.submit(null);
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
