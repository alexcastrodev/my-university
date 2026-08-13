import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing-page').then((m) => m.LandingPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile-page').then((m) => m.ProfilePage),
  },
  {
    path: 'review',
    loadComponent: () => import('./pages/review-queue/review-queue-page').then((m) => m.ReviewQueuePage),
  },
  {
    path: 'java/exams',
    loadComponent: () => import('./pages/exam-list/exam-list').then((m) => m.ExamListPage),
  },
  {
    path: 'java/java-minute',
    loadComponent: () => import('./pages/java-minute/java-minute-list').then((m) => m.JavaMinuteListPage),
  },
  {
    path: 'java/java-minute/:slug',
    loadComponent: () => import('./pages/java-minute/java-minute-detail').then((m) => m.JavaMinuteDetailPage),
  },
  {
    path: 'java/java-concepts',
    loadComponent: () => import('./pages/java-concepts/java-concepts-list').then((m) => m.JavaConceptsListPage),
  },
  {
    path: 'java/java-concepts/:slug',
    loadComponent: () => import('./pages/java-concepts/java-concepts-detail').then((m) => m.JavaConceptsDetailPage),
  },
  {
    path: 'java/jvm-concepts',
    loadComponent: () => import('./pages/jvm-concepts/jvm-concepts-list').then((m) => m.JvmConceptsListPage),
  },
  {
    path: 'java/jvm-concepts/:slug',
    loadComponent: () => import('./pages/jvm-concepts/jvm-concepts-detail').then((m) => m.JvmConceptsDetailPage),
  },
  {
    path: 'databases/database-concepts',
    loadComponent: () => import('./pages/database-concepts/database-concepts-list').then((m) => m.DatabaseConceptsListPage),
  },
  {
    path: 'databases/database-concepts/:slug',
    loadComponent: () => import('./pages/database-concepts/database-concepts-detail').then((m) => m.DatabaseConceptsDetailPage),
  },
  {
    path: 'system-design/system-design-concepts',
    loadComponent: () => import('./pages/system-design-concepts/system-design-concepts-list').then((m) => m.SystemDesignConceptsListPage),
  },
  {
    path: 'system-design/system-design-concepts/:slug',
    loadComponent: () => import('./pages/system-design-concepts/system-design-concepts-detail').then((m) => m.SystemDesignConceptsDetailPage),
  },
  {
    path: 'spring-concepts',
    loadComponent: () => import('./pages/spring-concepts/spring-concepts-list').then((m) => m.SpringConceptsListPage),
  },
  {
    path: 'spring-concepts/:slug',
    loadComponent: () => import('./pages/spring-concepts/spring-concepts-detail').then((m) => m.SpringConceptsDetailPage),
  },
  {
    path: 'java/testing',
    loadComponent: () => import('./pages/testing-concepts/testing-concepts-list').then((m) => m.TestingConceptsListPage),
  },
  {
    path: 'java/testing/:slug',
    loadComponent: () => import('./pages/testing-concepts/testing-concepts-detail').then((m) => m.TestingConceptsDetailPage),
  },
  {
    path: 'algorithms/algorithms-concepts',
    loadComponent: () => import('./pages/algorithms-concepts/algorithms-concepts-list').then((m) => m.AlgorithmsConceptsListPage),
  },
  {
    path: 'algorithms/algorithms-concepts/:slug',
    loadComponent: () => import('./pages/algorithms-concepts/algorithms-concepts-detail').then((m) => m.AlgorithmsConceptsDetailPage),
  },
  {
    path: 'java/exam/:examId/lesson/:lessonId',
    loadComponent: () => import('./pages/course/course-page').then((m) => m.CoursePage),
  },
  {
    path: 'java/exam/:examId/quiz',
    loadComponent: () => import('./pages/quiz/quiz-page').then((m) => m.QuizPage),
  },
  {
    path: 'java/exam/:examId/result/:attemptId',
    loadComponent: () => import('./pages/result/result-page').then((m) => m.ResultPage),
  },
  {
    path: 'java/exam/:examId/review/:attemptId',
    loadComponent: () => import('./pages/review/review-page').then((m) => m.ReviewPage),
  },
  {
    path: 'java/exam/:examId/attempts',
    loadComponent: () => import('./pages/attempts/attempts-page').then((m) => m.AttemptsPage),
  },
  {
    path: 'java/exam/:examId/share/:attemptId',
    loadComponent: () => import('./pages/share-result/share-result-page').then((m) => m.ShareResultPage),
  },
  {
    path: 'java/exam/:examId',
    loadComponent: () => import('./pages/course/course-page').then((m) => m.CoursePage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'leaderboard',
    loadComponent: () => import('./pages/leaderboard/leaderboard-page').then((m) => m.LeaderboardPage),
  },
  { path: '**', redirectTo: '' },
];
