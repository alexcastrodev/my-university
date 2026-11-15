import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { KurzService } from '../../kurz/kurz.service';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../../models/language.model';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { ThemeService } from '../../services/theme.service';
import { profileKey, publicProfileUrl } from '../../shared/public-profile-url';
import { XpService } from '../../services/xp.service';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';

/**
 * Account, language and theme in one place. On phones this is the fifth bottom-nav tab and
 * replaces the header entirely, so it also carries what only the header offered there: the
 * account links, logout, the language switcher and the Complementary Studies menu.
 */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmDialog, RouterLink],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage {
  protected auth = inject(AuthService);
  protected themeService = inject(ThemeService);
  protected languageService = inject(LanguageService);
  protected xpService = inject(XpService);
  protected kurz = inject(KurzService);
  private router = inject(Router);
  private locale = inject(LOCALE_ID);

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

  /** On unless the server says otherwise: replies notify by default. */
  protected readonly notifyReplies = computed(() => this.auth.currentUser()?.notifyReplies !== false);
  notifySaving = signal(false);
  notifyMessage = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  setNotifyReplies(on: boolean): void {
    if (on === this.notifyReplies() || this.notifySaving()) return;
    this.notifySaving.set(true);
    this.notifyMessage.set(null);
    this.auth.updateNotifyReplies(on).subscribe({
      next: () => {
        this.notifySaving.set(false);
        this.notifyMessage.set({ kind: 'success', text: $localize`:@@settings.saved:Saved.` });
      },
      error: () => {
        this.notifySaving.set(false);
        this.notifyMessage.set({ kind: 'error', text: $localize`:@@settings.error:Something went wrong. Try again.` });
      },
    });
  }

  /** What the student may do with the Kurz now, from the server. The erase button works even with the Kurz off. */
  protected readonly kurzStatus = this.kurz.status;
  protected kurzEraseOpen = signal(false);
  protected kurzBusy = signal(false);
  protected kurzMessage = signal<{ kind: 'success' | 'error'; text: string } | null>(null);

  constructor() {
    effect(() => {
      if (this.auth.currentUser()) void this.kurz.loadStatus();
    });
  }

  protected when(iso: string): string {
    return new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  }

  protected readonly eraseDialog = {
    heading: $localize`:@@kurz.settings.eraseDialog.title:Erase all your conversations?`,
    message: $localize`:@@kurz.settings.eraseDialog.body:Every conversation you had with the Kurz is erased for good and cannot be recovered. Reports you sent stay, without your name.`,
    confirm: $localize`:@@kurz.settings.eraseDialog.confirm:Erase everything`,
    cancel: $localize`:@@kurz.cancel:Cancel`,
  };

  /** The button only asks; the dialog's confirm button does the erasing. */
  protected askErase(): void {
    this.kurzMessage.set(null);
    this.kurzEraseOpen.set(true);
  }

  protected async eraseConversations(): Promise<void> {
    if (this.kurzBusy()) return;
    this.kurzBusy.set(true);
    const deleted = await this.kurz.deleteAll();
    this.kurzBusy.set(false);
    this.kurzEraseOpen.set(false);
    this.kurzMessage.set(
      deleted === null
        ? { kind: 'error', text: $localize`:@@settings.error:Something went wrong. Try again.` }
        : { kind: 'success', text: $localize`:@@kurz.settings.erased:Erased ${deleted}:count: conversations.` },
    );
  }

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
