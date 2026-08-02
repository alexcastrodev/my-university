import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ExamQuestion, QuestionReview } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';
import { QuizQuestion } from '../../components/quiz-question/quiz-question';

type Filter = 'wrong' | 'all';

@Component({
  selector: 'app-review-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, QuizQuestion],
  templateUrl: './review-page.html',
  styleUrl: './review-page.css',
})
export class ReviewPage implements OnInit {
  private route = inject(ActivatedRoute);
  private examService = inject(ExamService);

  examId = signal('');
  attemptId = signal(0);
  loading = signal(true);
  notFound = signal(false);
  reviewUnavailable = signal(false);
  review = signal<QuestionReview[]>([]);
  filter = signal<Filter>('wrong');

  wrongCount = computed(() => this.review().filter((r) => !r.correct).length);
  visibleReview = computed(() =>
    this.filter() === 'wrong' ? this.review().filter((r) => !r.correct) : this.review(),
  );

  ngOnInit() {
    const examId = this.route.snapshot.paramMap.get('examId') ?? '';
    const attemptId = Number(this.route.snapshot.paramMap.get('attemptId'));
    this.examId.set(examId);
    this.attemptId.set(attemptId);

    this.examService.getAttempt(examId, attemptId).subscribe({
      next: (attempt) => {
        if (attempt.review) {
          this.review.set(attempt.review);
        } else {
          this.reviewUnavailable.set(true);
        }
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.notFound.set(true); },
    });
  }

  setFilter(filter: Filter): void {
    this.filter.set(filter);
  }

  toQuestion(r: QuestionReview): ExamQuestion {
    return {
      id: r.id,
      examId: this.examId(),
      topic: r.topic,
      type: r.type,
      text: r.text,
      code: r.code,
      options: r.options,
    };
  }
}
