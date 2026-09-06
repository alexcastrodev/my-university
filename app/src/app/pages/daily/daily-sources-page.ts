import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { SeoService } from '../../services/seo.service';

const PATH = '/daily/sources';

interface SourceGroup {
  /** Terracotta bullet + tinted chips when true; neutral otherwise. */
  accent: boolean;
  label: string;
  description: string;
  chips: string[];
}

interface DailySources {
  eyebrow: string;
  title: string;
  groups: SourceGroup[];
  rulesLabel: string;
  rules: string[];
}

/**
 * "Where the cards come from" (mockups tmp/mobile/, screen 07). A static
 * explainer of the two tracks that feed the daily session and the order in
 * which topics are picked. Reached from the Daily home; keeps the Daily tab
 * active. The concrete lists are user-specific and will come from the backend
 * session builder later (tasks.md · grupo F) — modelled as data for that seam.
 */
@Component({
  selector: 'app-daily-sources-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './daily-sources-page.html',
  styleUrl: './daily-sources-page.css',
})
export class DailySourcesPage implements OnInit {
  private seo = inject(SeoService);

  protected readonly sources: DailySources = {
    eyebrow: 'DAILY · SOURCES',
    title: 'Both tracks feed the session',
    groups: [
      {
        accent: false,
        label: 'Computer Science',
        description:
          'Cards only from semesters you have entered. Semester 5 topics appear because you are reading them; Semester 6 does not appear at all.',
        chips: ['S2 Algorithms', 'S3 Architecture', 'S4 Databases', 'S5 Distributed'],
      },
      {
        accent: true,
        label: 'Complementary studies',
        description:
          'Your own areas, at their own depth. These supply most of the short cards, because the content is already written in small pieces.',
        chips: ['Java Concepts', 'Java Minute', 'JVM Internals', 'System Design'],
      },
    ],
    rulesLabel: 'SELECTION RULES',
    rules: [
      'Expiring marks come first.',
      'Then the topic you last read.',
      'Then one topic it opens.',
      'Never a topic whose prerequisites you have not entered.',
    ],
  };

  ngOnInit(): void {
    this.seo.set({
      title: 'Where the cards come from',
      description: 'The two tracks that feed your daily session, and the order topics are picked.',
      path: PATH,
    });
  }
}
