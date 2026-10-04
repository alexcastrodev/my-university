import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { ThemeService } from '../../services/theme.service';
import { XpService } from '../../services/xp.service';
import { SearchService } from '../../services/search.service';
import { LANGUAGE_LABELS, Language } from '../../models/language.model';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  protected languageService = inject(LanguageService);
  protected themeService = inject(ThemeService);
  private router = inject(Router);
  private searchService = inject(SearchService);
  private elementRef = inject(ElementRef);

  protected readonly LANGUAGE_LABELS = LANGUAGE_LABELS;

  /** Hint shown in the search trigger; Apple keyboards use ⌘, everything else Ctrl. */
  protected readonly shortcutLabel =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘K'
      : 'Ctrl K';
  userMenuOpen = signal(false);
  mobileMenuOpen = signal(false);
  languageMenuOpen = signal(false);

  userInitials = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return $localize`:@@header.signIn:Sign in`;

    return user.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  });

  toggleUser(): void {
    if (this.auth.currentUser()) {
      this.userMenuOpen.update((open) => !open);
      return;
    }
    void this.router.navigate(['/login']);
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  openSearch(): void {
    this.closeMobileMenu();
    this.searchService.open();
  }

  toggleLanguageMenu(): void {
    this.languageMenuOpen.update((open) => !open);
  }

  closeLanguageMenu(): void {
    this.languageMenuOpen.set(false);
  }

  setLanguage(lang: Language): void {
    this.closeLanguageMenu();
    this.languageService.setLanguage(lang);
  }

  logout(): void {
    this.closeUserMenu();
    this.auth.logout();
    void this.router.navigate(['/login']);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeUserMenu();
    this.closeMobileMenu();
    this.closeLanguageMenu();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.userMenuOpen()) {
      const userMenu = this.elementRef.nativeElement.querySelector('.user-menu');
      if (userMenu && !userMenu.contains(event.target as Node)) {
        this.closeUserMenu();
      }
    }

    if (this.mobileMenuOpen()) {
      const nav = this.elementRef.nativeElement.querySelector('.nav-links');
      const toggle = this.elementRef.nativeElement.querySelector('.mobile-menu-toggle');
      const target = event.target as Node;
      if (nav && toggle && !nav.contains(target) && !toggle.contains(target)) {
        this.closeMobileMenu();
      }
    }

    if (this.languageMenuOpen()) {
      const languageMenu = this.elementRef.nativeElement.querySelector('.language-menu');
      if (languageMenu && !languageMenu.contains(event.target as Node)) {
        this.closeLanguageMenu();
      }
    }
  }
}
