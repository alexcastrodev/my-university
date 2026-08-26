import { Injectable, signal } from '@angular/core';

const RELOAD_FLAG_KEY = 'chunk-load-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;
/** Gives the toast a moment on screen before the page reloads out from under it. */
const RELOAD_DELAY_MS = 1200;

/**
 * Self-heals the classic "stale tab after a deploy" failure: a lazy route chunk 404s because the
 * tab loaded before this deploy replaced the hashed chunk filenames. A reload picks up the
 * current build's chunk names and the navigation just works — no visitor needs to know to
 * hard-refresh, but they do see a brief heads-up for why the page moved.
 *
 * Guarded by a cooldown (rather than a single-use flag, which a reload would reset anyway) so a
 * genuinely broken deployment doesn't reload in a loop, and by `navigator.onLine` so a visitor
 * who's actually offline doesn't get bounced into a reload that can't succeed anyway.
 */
@Injectable({ providedIn: 'root' })
export class ChunkReloadService {
  readonly visible = signal(false);

  recover(url?: string): void {
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
    if (!navigator.onLine) return;

    const lastReload = Number(sessionStorage.getItem(RELOAD_FLAG_KEY) ?? 0);
    if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));

    this.visible.set(true);
    setTimeout(() => {
      if (url) window.location.href = url;
      else window.location.reload();
    }, RELOAD_DELAY_MS);
  }
}
