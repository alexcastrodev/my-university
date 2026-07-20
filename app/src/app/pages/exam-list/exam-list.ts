import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Exam } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';

@Component({
  selector: 'app-exam-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './exam-list.html',
  styleUrl: './exam-list.css',
})
export class ExamListPage implements OnInit {
  private examService = inject(ExamService);

  exams = signal<Exam[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.examService.listExams().subscribe({
      next: (list) => { this.exams.set(list); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  categories(): string[] {
    return [...new Set(this.exams().map((e) => e.category))].sort();
  }

  byCategory(category: string): Exam[] {
    return this.exams().filter((e) => e.category === category);
  }

  categoryIcon(category: string): string {
    return category === 'Language' ? '☕' : '🗄️';
  }
}
