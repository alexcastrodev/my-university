import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Exam } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { SeoService } from '../../services/seo.service';

interface Provider {
  key: string;
  name: string;
  owns: (examId: string) => boolean;
  /** What the version chip on the card says: Oracle exams are named by their Java release, the rest by exam code. */
  badge: (exam: Exam) => string;
}

// ponytail: the vendor comes from the exam id prefix. Add a `provider` column to Exam if a vendor ever
// needs more than a prefix to be recognised.
const PROVIDERS: Provider[] = [
  { key: 'oracle', name: 'Oracle Java', owns: (id) => id.startsWith('java-'), badge: (e) => `Java SE ${e.version}` },
  { key: 'microsoft', name: 'Microsoft Azure', owns: (id) => id.startsWith('azure-'), badge: (e) => e.version },
  // Catch-all, so an exam seeded with an unexpected id still shows up instead of vanishing.
  { key: 'other', name: 'More exams', owns: () => true, badge: (e) => e.version },
];

/** Newest release first, so OCP 25 sits before OCP 21. */
const newestFirst = (a: Exam, b: Exam) => b.version.localeCompare(a.version, undefined, { numeric: true });

@Component({
  selector: 'app-exam-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './exam-list.html',
  styleUrl: './exam-list.css',
})
export class ExamListPage implements OnInit {
  private examService = inject(ExamService);
  private seo = inject(SeoService);

  exams = signal<Exam[]>([]);
  loading = signal(true);

  /** One section per vendor that has at least one exam, in the order of PROVIDERS. */
  groups = computed(() => {
    const byProvider = new Map<Provider, Exam[]>();
    for (const exam of this.exams()) {
      const provider = PROVIDERS.find((p) => p.owns(exam.id))!;
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), exam]);
    }
    return PROVIDERS.filter((p) => byProvider.has(p)).map((provider) => ({
      provider,
      exams: byProvider.get(provider)!.sort(newestFirst),
    }));
  });

  ngOnInit() {
    this.seo.set({
      title: 'Certification Exams',
      description:
        'Practice certification exams for Oracle Java (OCP SE 25 and 21) and Microsoft Azure (AI-200) with randomised questions, lessons, and instant scoring.',
      path: '/exams',
    });

    this.examService.listExams().subscribe({
      next: (list) => { this.exams.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
