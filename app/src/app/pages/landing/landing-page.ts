import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
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

  sessions = SESSIONS;

  ngOnInit() {
    this.seo.set({
      title: 'My University',
      description: 'Practice exams, quick answers, and in-depth concepts for Java, Spring, and Databases.',
      path: '/',
    });
  }
}
