import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResumePoint } from '../../models/course.model';
import { AuthService } from '../../services/auth.service';
import { ResumeService } from '../../services/resume.service';
import { SeoService } from '../../services/seo.service';

interface LandingSession {
  title: string;
  description: string;
  icon: string;
  routerLink: string;
}

const SESSIONS: LandingSession[] = [
  {
    title: 'Java',
    description: 'Certification practice exams, Java Minute quick answers, and in-depth Java Concepts.',
    icon: '☕',
    routerLink: '/java/exams',
  },
  {
    title: 'Spring',
    description: 'Spring Boot, Spring Security, and Spring Batch concepts explained in depth.',
    icon: '🌱',
    routerLink: '/spring-concepts',
  },
  {
    title: 'Databases',
    description: 'PostgreSQL and SQL concepts, built up one book chapter at a time.',
    icon: '🗄️',
    routerLink: '/databases/database-concepts',
  },
  {
    title: 'System Design',
    description: 'Distributed systems and architecture patterns explained in depth.',
    icon: '🧩',
    routerLink: '/system-design/system-design-concepts',
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
      title: 'My University',
      description: 'Practice exams, quick answers, and in-depth concepts for Java, Spring, and Databases.',
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
