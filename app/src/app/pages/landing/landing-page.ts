import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResumePoint } from '../../models/course.model';
import { AuthService } from '../../services/auth.service';
import { ResumeService } from '../../services/resume.service';
import { SeoService } from '../../services/seo.service';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';
import { TranslationKey } from '../../shared/i18n/translations';

interface LandingSessionLink {
  label: TranslationKey;
  routerLink: string;
}

interface LandingSession {
  title: TranslationKey;
  description: TranslationKey;
  icon: string;
  /** Single destination for the whole card — used when there is only one place to go. */
  routerLink?: string;
  /** Multiple destinations — rendered as separate links so each promised topic is reachable. */
  links?: LandingSessionLink[];
}

const SESSIONS: LandingSession[] = [
  {
    title: 'landing.sessions.java.title',
    description: 'landing.sessions.java.description',
    icon: '☕',
    links: [
      { label: 'landing.link.exams', routerLink: '/java/exams' },
      { label: 'landing.link.concepts', routerLink: '/java/java-concepts' },
      { label: 'landing.link.jvmConcepts', routerLink: '/java/jvm-concepts' },
      { label: 'landing.link.javaMinute', routerLink: '/java/java-minute' },
    ],
  },
  {
    title: 'landing.sessions.spring.title',
    description: 'landing.sessions.spring.description',
    icon: '🌱',
    routerLink: '/spring-concepts',
  },
  {
    title: 'landing.sessions.quarkus.title',
    description: 'landing.sessions.quarkus.description',
    icon: '⚛️',
    routerLink: '/quarkus-concepts',
  },
  {
    title: 'landing.sessions.ruby.title',
    description: 'landing.sessions.ruby.description',
    icon: '💎',
    links: [
      { label: 'landing.link.concepts', routerLink: '/ruby-concepts' },
      { label: 'landing.link.rails', routerLink: '/rubyonrails-concepts' },
    ],
  },
  {
    title: 'landing.sessions.databases.title',
    description: 'landing.sessions.databases.description',
    icon: '🗄️',
    routerLink: '/databases/database-concepts',
  },
  {
    title: 'landing.sessions.systemDesign.title',
    description: 'landing.sessions.systemDesign.description',
    icon: '🧩',
    routerLink: '/system-design/system-design-concepts',
  },
  {
    title: 'landing.sessions.algorithms.title',
    description: 'landing.sessions.algorithms.description',
    icon: '📈',
    routerLink: '/algorithms/algorithms-concepts',
  },
];

@Component({
  selector: 'app-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.css',
})
export class LandingPage implements OnInit {
  private seo = inject(SeoService);
  private auth = inject(AuthService);
  private resumeService = inject(ResumeService);

  sessions = SESSIONS;
  resumePoint = signal<ResumePoint | null>(null);

  ngOnInit() {
    this.seo.set({
      title: 'My University — Learn Java, Ruby, Spring, PostgreSQL & System Design',
      description: 'Learn Java, JVM internals, Spring Boot, Ruby, Ruby on Rails, PostgreSQL, system design, and algorithms through in-depth concepts, hands-on labs, and certification practice exams.',
      path: '/',
    });

    if (this.auth.currentUser()) {
      this.resumeService.getResumePoint().subscribe({
        next: (point) => this.resumePoint.set(point),
        error: () => {},
      });
    }
  }

  resumeLink(): string[] {
    const point = this.resumePoint();
    if (!point) return [];
    return point.lessonId
      ? ['/java/exam', point.courseId, 'lesson', point.lessonId]
      : ['/java/exam', point.courseId];
  }
}
