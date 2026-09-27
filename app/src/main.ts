/// <reference types="@angular/localize" />

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { startSentry } from './app/sentry';

bootstrapApplication(App, appConfig)
  .then((appRef) => startSentry(appRef.injector))
  .catch((err) => console.error(err));
