import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Server,
  },
  {
    path: 'login',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'java-minute',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java-minute/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'spring-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'spring-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
