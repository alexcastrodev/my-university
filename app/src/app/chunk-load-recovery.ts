import { ErrorHandler, Injectable, inject } from '@angular/core';
import { NavigationError } from '@angular/router';
import { ChunkReloadService } from './services/chunk-reload.service';

/**
 * What each engine says when a dynamic `import()` fails. Chrome and Firefox name the chunk URL
 * (the pattern Angular's own team uses for angular.dev), but Safari only says "Importing a
 * module script failed." with no URL at all, so on iOS a stale chunk used to fail silently and
 * the tab the user tapped simply never opened.
 */
const CHUNK_LOAD_PATTERNS = [
  /chunk-(.*?)\.(js|mjs)/,
  /Importing a module script failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n')[0] ?? '';
  return CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(firstLine));
}

/** Router-level catch: covers navigations that fail with a resolvable target URL. */
export function recoverFromChunkLoadError(event: NavigationError): void {
  if (isChunkLoadError(event.error)) inject(ChunkReloadService).recover(event.url);
}

/**
 * App-wide catch: `withNavigationErrorHandler` alone misses some lazy-component load failures
 * (see https://github.com/angular/angular/issues/56958) — a global ErrorHandler is the backstop
 * the Angular team itself relies on for this exact case.
 */
@Injectable()
export class ChunkLoadErrorHandler implements ErrorHandler {
  private chunkReload = inject(ChunkReloadService);

  handleError(error: unknown): void {
    if (isChunkLoadError(error)) {
      this.chunkReload.recover();
      return;
    }
    console.error(error);
  }
}
