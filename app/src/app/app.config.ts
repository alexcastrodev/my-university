import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { credentialsInterceptor } from './interceptors/credentials.interceptor';
import { absoluteUrlInterceptor } from './interceptors/ssr-absolute-url.interceptor';
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions, withNoIncrementalHydration } from '@angular/platform-browser';
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
    provideHttpClient(withInterceptors([credentialsInterceptor, absoluteUrlInterceptor])),
    provideClientHydration(
      withEventReplay(),
      withNoIncrementalHydration(),
      withHttpTransferCacheOptions({ includeRequestsWithCredentials: true }),
    ),
    { provide: ErrorHandler, useClass: ChunkLoadErrorHandler },
  ]
};
