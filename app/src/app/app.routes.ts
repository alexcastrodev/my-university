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
    path: 'spring-concepts',
    loadComponent: () => import('./pages/spring-concepts/spring-concepts-list').then((m) => m.SpringConceptsListPage),
  },
  {
    path: 'spring-concepts/:slug',
    loadComponent: () => import('./pages/spring-concepts/spring-concepts-detail').then((m) => m.SpringConceptsDetailPage),
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
    path: 'java/exam/:examId',
    loadComponent: () => import('./pages/course/course-page').then((m) => m.CoursePage),
  },
  { path: '**', redirectTo: '' },
];
