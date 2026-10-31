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
    path: 'computer-science',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'computer-science/:module/:discipline',
    renderMode: RenderMode.Server,
  },
  {
    path: 'computer-science/:module/:discipline/:slug',
    renderMode: RenderMode.Server,
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
    path: 'quarkus-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'quarkus-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'kubernetes-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'papers',
    renderMode: RenderMode.Server,
  },
  {
    // The reader's own papers: private, so the server renders only the shell and the browser fetches the list.
    path: 'library',
    renderMode: RenderMode.Client,
  },
  {
    // Depends on who is signed in, which the server never knows: nothing to render ahead.
    path: 'library/add',
    renderMode: RenderMode.Client,
  },
  {
    path: 'library/:paperId',
    renderMode: RenderMode.Client,
  },
  {
    // The PDF is the reader's own and is drawn by the browser: the server renders only the shell.
    path: 'library/:paperId/read',
    renderMode: RenderMode.Client,
  },
  {
    path: 'papers/:id',
    renderMode: RenderMode.Server,
  },
  {
    path: 'kubernetes-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'ruby-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'ruby-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'rubyonrails-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'rubyonrails-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'dotnet-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'dotnet-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'tracks',
    renderMode: RenderMode.Server,
  },
  {
    path: 'csharp-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'csharp-minute',
    renderMode: RenderMode.Server,
  },
  {
    path: 'csharp-minute/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'csharp-concepts/:slug',
    renderMode: RenderMode.Server,
  },
  {
    path: 'dotnet-testing-concepts',
    renderMode: RenderMode.Server,
  },
  {
    path: 'dotnet-testing-concepts/:slug',
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
    path: 'dashboard',
    renderMode: RenderMode.Client,
  },
  {
    // Renders an interactive Cytoscape graph — a canvas-manipulating widget outside
    // Angular's own DOM reactivity, which SSR+hydration doesn't handle: the server-rendered
    // markup has no canvas (guarded off during SSR, see MapPage's own platform check), and
    // hydration's DOM-repair step for a mismatched subtree can orphan whatever the client
    // mounts into it afterward. Client rendering sidesteps the whole class of bug, matching
    // the pattern the "personalized / app-only routes" above already establish.
    path: 'map',
    renderMode: RenderMode.Client,
  },
  {
    path: 'profile',
    renderMode: RenderMode.Client,
  },
  {
    path: 'profile/activity',
    renderMode: RenderMode.Client,
  },
  {
    path: 'profile/achievements',
    renderMode: RenderMode.Client,
  },
  {
    // Public learner profile: the server renders only the shell and the share tags (the og:image points at
    // the API, which checks that the profile is public). The profile itself is fetched in the browser, never
    // baked into SSR output, since it can turn private at any moment.
    path: 'u/:profileKey',
    renderMode: RenderMode.Server,
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
    // Per-viewer tabs and flags, and the list changes by the minute: nothing worth server-rendering.
    path: 'discussions',
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
