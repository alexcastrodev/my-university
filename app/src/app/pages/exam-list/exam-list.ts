import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Exam } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { SeoService } from '../../services/seo.service';

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

  ngOnInit() {
    this.seo.set({
      title: 'Certification Exams',
      description: 'Practice Java certification exams with randomised questions, lessons, and instant scoring.',
      path: '/java/exams',
    });

    this.examService.listExams().subscribe({
      next: (list) => { this.exams.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
