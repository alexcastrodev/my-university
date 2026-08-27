import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';
import { TranslateService } from '../../shared/i18n/translate.service';

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  protected auth = inject(AuthService);
  private translate = inject(TranslateService);

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
        this.message.set({ kind: 'success', text: this.translate.t('settings.saved') });
      },
      error: () => {
        this.saving.set(false);
        this.message.set({ kind: 'error', text: this.translate.t('settings.error') });
      },
    });
  }
}
