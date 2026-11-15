import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DiscussionService } from '../discussion/discussion.service';
import { PHONE_MEDIA_QUERY } from '../shared/breakpoints';
import { TextSelectionService } from '../services/text-selection';
import { KurzAvatar } from './kurz-avatar';
import { KurzService } from './kurz.service';

/**
 * The Kurz's floating button on phones: a conversation about the whole post, with no passage. It only
 * exists on a post, while the Kurz is on, and it steps aside for the panel and for the selection bar.
 */
@Component({
  selector: 'app-kurz-fab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KurzAvatar],
  template: `
    @if (visible()) {
      <button
        type="button"
        class="fab"
        data-testid="kurz-fab"
        i18n-aria-label="@@kurz.fab"
        aria-label="Ask the Kurz about this post"
        (click)="discussion.openPost()"
      >
        <app-kurz-avatar [size]="40" />
      </button>
    }
  `,
  styles: `
    .fab {
      position: fixed;
      right: 16px;
      bottom: calc(var(--mu-nav-h) + var(--mu-safe-bottom) + 16px);
      z-index: 80;
      width: 56px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 2px solid var(--mu-surface);
      border-radius: 50%;
      background: var(--mu-accent-soft);
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.3);
      cursor: pointer;
    }
    @media (prefers-reduced-motion: no-preference) {
      .fab {
        animation: fab-in 0.2s ease-out;
      }
    }
    @keyframes fab-in {
      from {
        opacity: 0;
        transform: scale(0.8);
      }
    }
  `,
})
export class KurzFab {
  protected discussion = inject(DiscussionService);
  private kurz = inject(KurzService);
  private selection = inject(TextSelectionService).selection;

  private phone = signal(false);
  protected visible = computed(
    () =>
      this.phone() &&
      this.discussion.available() &&
      this.kurz.enabled() &&
      !this.discussion.panelOpen() &&
      this.selection() === null,
  );

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const query = matchMedia(PHONE_MEDIA_QUERY);
    this.phone.set(query.matches);
    const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
}
