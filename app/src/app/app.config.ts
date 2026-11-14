import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { awardsInterceptor } from './interceptors/awards.interceptor';
import { credentialsInterceptor } from './interceptors/credentials.interceptor';
import { absoluteUrlInterceptor } from './interceptors/ssr-absolute-url.interceptor';
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions, withI18nSupport, withNoIncrementalHydration } from '@angular/platform-browser';
import { STORED_USER_KEY } from './services/auth.service';
import { ChunkLoadErrorHandler, recoverFromChunkLoadError } from './chunk-load-recovery';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
      withNavigationErrorHandler(recoverFromChunkLoadError),
    ),
    provideHttpClient(withInterceptors([credentialsInterceptor, absoluteUrlInterceptor, awardsInterceptor])),
    provideClientHydration(
      withEventReplay(),
      // Without it every component with i18n markup is skipped and re-rendered from scratch on the client (CLS ~0.45 on mobile).
      withI18nSupport(),
      withNoIncrementalHydration(),
      withHttpTransferCacheOptions({
        includeRequestsWithCredentials: true,
        // SSR never forwards cookies, so its cached responses are signed-out (`read: false`); a signed-in browser must refetch.
        filter: () => typeof localStorage === 'undefined' || !localStorage.getItem(STORED_USER_KEY),
      }),
    ),
    { provide: ErrorHandler, useClass: ChunkLoadErrorHandler },
  ]
};
