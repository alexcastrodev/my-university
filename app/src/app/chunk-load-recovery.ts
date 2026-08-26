import { ErrorHandler, Injectable, inject } from '@angular/core';
import { NavigationError } from '@angular/router';
import { ChunkReloadService } from './services/chunk-reload.service';

/**
 * Matches the errors browsers throw when a lazy-loaded chunk 404s or otherwise fails to load.
 * Same pattern Angular's own team uses for angular.dev:
 * https://github.com/angular/angular/blob/main/adev/src/app/core/services/errors-handling/error-handler.ts
 */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n')[0] ?? '';
  return /chunk-(.*?)\.(js|mjs)/.test(firstLine);
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
