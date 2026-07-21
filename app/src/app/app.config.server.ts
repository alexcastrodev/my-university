import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { ssrAbsoluteUrlInterceptor } from './interceptors/ssr-absolute-url.interceptor';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideHttpClient(withFetch(), withInterceptors([ssrAbsoluteUrlInterceptor])),
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
