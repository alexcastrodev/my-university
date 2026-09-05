import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { COMPLEMENTARY_AREAS } from '../computer-science/complementary-studies.data';
import { AuthService } from '../../services/auth.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

interface TopicCard {
  icon: string;
  title: string;
  tagline: string;
  routerLink: string;
}

const AREA_ICONS: Record<string, string> = {
  'java-concepts': '☕',
  'java-minute': '⏱️',
  'jvm-concepts': '⚙️',
  'testing-concepts': '🧪',
  'spring-concepts': '🌱',
  'quarkus-concepts': '⚛️',
  'ruby-concepts': '💎',
  'rubyonrails-concepts': '🛤️',
  'database-concepts': '🗄️',
  'system-design-concepts': '🧩',
  'algorithms-concepts': '📈',
};

/** Simple one-card-per-area grid — no nested sub-links, no per-card paragraph. The
 *  reference data (title, route, one-line relationship) is the same registry the
 *  Computer Science Track page uses for "Complementary Studies", so both stay in sync. */
const TOPIC_CARDS: TopicCard[] = COMPLEMENTARY_AREAS.map((area) => ({
  icon: AREA_ICONS[area.slug] ?? '📘',
  title: area.title,
  tagline: area.relationship,
  routerLink: area.routerLink,
}));

/** Logged-out marketing page only — a logged-in user is redirected straight to
 *  /dashboard in ngOnInit, so this component never renders content for them. */
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
  private router = inject(Router);
  protected readonly xpService = inject(XpService);

  protected readonly topics = TOPIC_CARDS;

  ngOnInit() {
    if (this.auth.currentUser()) {
      this.router.navigate(['/dashboard'], { replaceUrl: true });
      return;
    }

    this.seo.set({
      title: 'My University — A Computer Science curriculum, one topic at a time',
      description: 'A from-scratch Computer Science curriculum plus Java, Ruby, Spring, PostgreSQL, system design, and algorithms — tracked by XP, one topic at a time.',
      path: '/',
    });

    // Public endpoint — safe to show to a logged-out visitor as real, live proof
    // the platform has real learners, without fabricating testimonials.
    this.xpService.loadLeaderboard();
  }
}
