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
    path: 'java/jvm-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/jvm-concepts/:slug',
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
    path: 'databases/database-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'databases/database-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'system-design/system-design-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'system-design/system-design-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'algorithms/algorithms-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'algorithms/algorithms-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/testing',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/testing/:slug',
    renderMode: RenderMode.Server,
  },
  // Personalized / app-only routes — unchanged Client rendering, listed explicitly so the
  // catch-all below (used to serve a real 404 status) doesn't accidentally start SSR-ing them.
  {
    path: 'profile',
    renderMode: RenderMode.Client,
  },
  {
    path: 'review',
    renderMode: RenderMode.Client,
  },
  {
    path: 'settings',
    renderMode: RenderMode.Client,
  },
  {
    path: 'leaderboard',
    renderMode: RenderMode.Client,
  },
  {
    path: 'java/exam/:examId/lesson/:lessonId',
    renderMode: RenderMode.Server,
  },
  {
    path: 'java/exam/:examId/quiz',
    renderMode: RenderMode.Client,
  },
  {
    path: 'java/exam/:examId/result/:attemptId',
    renderMode: RenderMode.Client,
  },
  {
    path: 'java/exam/:examId/review/:attemptId',
    renderMode: RenderMode.Client,
  },
  {
    path: 'java/exam/:examId/attempts',
    renderMode: RenderMode.Client,
  },
  {
    path: 'java/exam/:examId/share/:attemptId',
    renderMode: RenderMode.Client,
  },
  {
    path: 'java/exam/:examId',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
