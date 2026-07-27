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
    path: 'java/exams',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/java-minute',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/java-minute/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/java-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/java-concepts/:slug',
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
