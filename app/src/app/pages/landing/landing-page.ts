import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResumePoint } from '../../models/course.model';
import { AuthService } from '../../services/auth.service';
import { ResumeService } from '../../services/resume.service';
import { SeoService } from '../../services/seo.service';

interface LandingSessionLink {
  label: string;
  routerLink: string;
}

interface LandingSession {
  title: string;
  description: string;
  icon: string;
  /** Single destination for the whole card — used when there is only one place to go. */
  routerLink?: string;
  /** Multiple destinations — rendered as separate links so each promised topic is reachable. */
  links?: LandingSessionLink[];
}

const SESSIONS: LandingSession[] = [
  {
    title: 'Java',
    description: 'Certification practice exams, Java Minute quick answers, and in-depth Java Concepts.',
    icon: '☕',
    links: [
      { label: 'Exams', routerLink: '/java/exams' },
      { label: 'Concepts', routerLink: '/java/java-concepts' },
      { label: 'JVM Concepts', routerLink: '/java/jvm-concepts' },
      { label: 'Java Minute', routerLink: '/java/java-minute' },
    ],
  },
  {
    title: 'Spring',
    description: 'Spring Boot, Spring Security, and Spring Batch concepts explained in depth.',
    icon: '🌱',
    routerLink: '/spring-concepts',
  },
  {
    title: 'Ruby',
    description: 'Ruby language internals and Ruby on Rails performance concepts explained in depth.',
    icon: '💎',
    links: [
      { label: 'Concepts', routerLink: '/ruby-concepts' },
      { label: 'Rails', routerLink: '/rubyonrails-concepts' },
    ],
  },
  {
    title: 'Databases',
    description: 'PostgreSQL, SQL, MongoDB, and DynamoDB concepts, built up one book chapter at a time.',
    icon: '🗄️',
    routerLink: '/databases/database-concepts',
  },
  {
    title: 'System Design',
    description: 'Distributed systems and architecture patterns explained in depth.',
    icon: '🧩',
    routerLink: '/system-design/system-design-concepts',
  },
  {
    title: 'Algorithms',
    description: 'Core algorithms and data structures, with visualizations to build intuition.',
    icon: '📈',
    routerLink: '/algorithms/algorithms-concepts',
  },
];

@Component({
  selector: 'app-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
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
