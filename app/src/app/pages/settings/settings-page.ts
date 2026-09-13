import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  protected auth = inject(AuthService);
  protected themeService = inject(ThemeService);

  displayName = signal(this.auth.currentUser()?.displayName ?? '');
  saving = signal(false);
  message = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  save(): void {
    this.submit(this.displayName());
  }

  resetToGithubName(): void {
    this.submit(null);
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
