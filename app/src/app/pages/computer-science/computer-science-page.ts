import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { COMPLEMENTARY_AREAS, ComplementaryArea } from './complementary-studies.data';
import {
  ComplementaryAreaProgress,
  ComplementaryStudiesService,
} from './complementary-studies.service';
import { CURRICULUM, CurriculumModule } from './curriculum.data';

const PATH = '/computer-science';
type Tab = 'cs' | 'complementary' | 'parallel';

interface OtherField {
  title: string;
  description: string;
  isCs?: boolean;
}

const OTHER_FIELDS: OtherField[] = [
  { title: 'Mathematics', description: 'Feeds every module here, and every theory topic' },
  { title: 'Computer Science', description: 'This curriculum sits inside this field', isCs: true },
  { title: 'Physics', description: 'Computation as a physical process' },
  { title: 'Engineering', description: 'Building things that must not fail' },
  { title: 'Artificial Intelligence', description: 'Its own frontier, not a chapter of CS' },
  { title: 'Biology', description: 'Computation found rather than designed' },
  { title: 'Economics', description: 'Incentives, mechanisms, distributed decisions' },
  { title: 'Philosophy', description: 'What counts as knowing, and as intelligence' },
];

@Component({
  selector: 'app-computer-science-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './computer-science-page.html',
  styleUrl: './computer-science-page.css',
})
export class ComputerSciencePage implements OnInit {
  private seo = inject(SeoService);
  private complementaryService = inject(ComplementaryStudiesService);

  protected readonly tableModules: CurriculumModule[] = CURRICULUM.filter(
    (m) => m.disciplines && m.slug !== 'research',
  );
  protected readonly specializationModule = CURRICULUM.find((m) => m.slug === 'specialization')!;
  protected readonly researchModule = CURRICULUM.find((m) => m.slug === 'research')!;
  protected readonly researchTopics: string[] = this.researchModule.disciplines?.[0]?.topics ?? [];
  protected readonly otherFields = OTHER_FIELDS;
  protected readonly complementaryAreas: ComplementaryArea[] = COMPLEMENTARY_AREAS;

  protected readonly activeTab = signal<Tab>('cs');
  protected readonly complementaryProgress = signal<ComplementaryAreaProgress[]>([]);
  protected readonly complementaryLoading = signal(false);
  private complementaryLoaded = false;

  ngOnInit() {
    this.seo.set({
      title: 'Computer Science',
      description:
        'A from-scratch Computer Science curriculum, organized as a knowledge graph instead of a locked semester grid — foundations, algorithms, systems, AI, and independent research.',
      path: PATH,
    });
  }

  setTab(tab: Tab) {
    this.activeTab.set(tab);
    if (tab === 'complementary' && !this.complementaryLoaded) {
      this.complementaryLoaded = true;
      this.complementaryLoading.set(true);
      this.complementaryService.listProgress().subscribe({
        next: (progress) => {
          this.complementaryProgress.set(progress);
          this.complementaryLoading.set(false);
        },
        error: () => this.complementaryLoading.set(false),
      });
    }
  }

  progressFor(slug: string): ComplementaryAreaProgress | undefined {
    return this.complementaryProgress().find((p) => p.slug === slug);
  }

  moduleTitle(slug: string): string {
    return CURRICULUM.find((m) => m.slug === slug)?.title ?? slug;
  }

  totalHours(mod: CurriculumModule): number {
    return (mod.disciplines ?? []).reduce((sum, d) => sum + (d.hours ?? 0), 0);
  }
}
