import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ExamQuestion } from '../../models/exam.model';

/** Renders a single quiz question with its options. Shared by the timed exam and skill-check views. */
@Component({
  selector: 'app-quiz-question',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quiz-question.html',
  styleUrl: './quiz-question.css',
})
export class QuizQuestion {
  question = input.required<ExamQuestion>();
  selectedKeys = input<string[]>([]);
  disabled = input(false);
  showTopicBadge = input(false);
  /** When true, options are colored by correctness (used after an attempt is submitted). */
  reviewing = input(false);
  correctKeys = input<string[] | null>(null);

  toggle = output<string>();

  hasAnswer(): boolean {
    return this.selectedKeys().length > 0;
  }

  isSelected(key: string): boolean {
    return this.selectedKeys().includes(key);
  }

  isCorrect(key: string): boolean {
    return this.correctKeys()?.includes(key) ?? false;
  }

  onToggle(key: string): void {
    if (!this.disabled()) this.toggle.emit(key);
  }
}
