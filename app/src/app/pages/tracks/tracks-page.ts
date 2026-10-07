import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TrackIcon } from '../../components/track-icon/track-icon';
import { SeoService } from '../../services/seo.service';
import { COMPLEMENTARY_AREAS } from '../computer-science/complementary-studies.data';
import {
  ComplementaryAreaProgress,
  ComplementaryStudiesService,
} from '../computer-science/complementary-studies.service';

type Group = 'java' | 'ruby' | 'dotnet' | 'fundamentals';
type Kind = 'language' | 'framework' | 'platform' | 'theory' | 'quick';

interface TrackMeta {
  group: Group;
  kind: Kind;
}

/** Grouping and card chrome for the registry's areas; the registry stays the source of titles and routes. */
const META: Record<string, TrackMeta> = {
  'java-concepts': { group: 'java', kind: 'language' },
  'java-minute': { group: 'java', kind: 'quick' },
  'jvm-concepts': { group: 'java', kind: 'platform' },
  'testing-concepts': { group: 'java', kind: 'framework' },
  'spring-concepts': { group: 'java', kind: 'framework' },
  'quarkus-concepts': { group: 'java', kind: 'framework' },
  'ruby-concepts': { group: 'ruby', kind: 'language' },
  'rubyonrails-concepts': { group: 'ruby', kind: 'framework' },
  'dotnet-concepts': { group: 'dotnet', kind: 'platform' },
  'csharp-concepts': { group: 'dotnet', kind: 'language' },
  'csharp-minute': { group: 'dotnet', kind: 'quick' },
  'database-concepts': { group: 'fundamentals', kind: 'theory' },
  'system-design-concepts': { group: 'fundamentals', kind: 'theory' },
  'kubernetes-concepts': { group: 'fundamentals', kind: 'platform' },
  'algorithms-concepts': { group: 'fundamentals', kind: 'theory' },
};

interface TrackCard {
  slug: string;
  title: string;
  group: Group;
  kind: Kind;
  routerLink: string;
}

/** The OCP exams are not a Complementary Studies area, so they get a card of their own. */
const EXAMS_CARD: TrackCard = {
  slug: 'java-exams',
  title: 'OCP Java 25 Exams',
  group: 'java',
  kind: 'quick',
  routerLink: '/java/exams',
};

const CARDS: TrackCard[] = [
  EXAMS_CARD,
  ...COMPLEMENTARY_AREAS.map((a) => ({
    slug: a.slug,
    title: a.title,
    routerLink: a.routerLink,
    ...(META[a.slug] ?? { group: 'fundamentals' as Group, kind: 'theory' as Kind }),
  })),
];

@Component({
  selector: 'app-tracks-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TrackIcon],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPage implements OnInit {
  private seo = inject(SeoService);
  private studies = inject(ComplementaryStudiesService);

  protected readonly groups: Group[] = ['java', 'ruby', 'dotnet', 'fundamentals'];
  protected readonly query = signal('');
  protected readonly group = signal<Group | 'all'>('all');
  protected readonly progress = signal<ComplementaryAreaProgress[]>([]);
  protected readonly loading = signal(true);

  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const g = this.group();
    return CARDS.filter(
      (c) => (g === 'all' || c.group === g) && (!q || c.title.toLowerCase().includes(q)),
    );
  });

  ngOnInit() {
    this.seo.set({
      title: 'Tracks',
      description: 'Every study track in one place: Java, Spring, Ruby, .NET, C#, databases, system design and more.',
      path: '/tracks',
    });
    this.studies.listProgress().subscribe({
      next: (list) => { this.progress.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  protected progressFor(slug: string): ComplementaryAreaProgress | undefined {
    return this.progress().find((p) => p.slug === slug);
  }

  protected percent(slug: string): number {
    const p = this.progressFor(slug);
    return p && p.total ? Math.round((p.read / p.total) * 100) : 0;
  }

  protected onQuery(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
