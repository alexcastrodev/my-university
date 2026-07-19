import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ExamQuestion } from '../../models/exam.model';

/** Renders a single quiz question with its options. Shared by the timed exam and skill-check views. */
@Component({
  selector: 'app-quiz-question',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="question-card">
      <div class="question-meta">
        @if (showTopicBadge()) {
          <span class="topic-badge">{{ question().topic }}</span>
        }
        <span class="type-badge">{{ question().type === 'multi' ? 'Multiple answers' : 'Single answer' }}</span>
      </div>

      <p class="question-text">{{ question().text }}</p>

      @if (question().code) {
        <pre class="code-block" aria-label="Code snippet"><code>{{ question().code }}</code></pre>
      }

      <fieldset class="options" [attr.aria-label]="question().type === 'multi' ? 'Select all correct answers' : 'Select the correct answer'">
        <legend class="sr-only">{{ question().type === 'multi' ? 'Select all correct answers' : 'Select the correct answer' }}</legend>
        @for (opt of question().options; track opt.key) {
          <label
            class="option"
            [class.selected]="isSelected(opt.key)"
            [class.correct]="reviewing() && hasAnswer() && isCorrect(opt.key)"
            [class.wrong]="reviewing() && isSelected(opt.key) && !isCorrect(opt.key)"
          >
            <input
              [type]="question().type === 'multi' ? 'checkbox' : 'radio'"
              [name]="'q-' + question().id"
              [value]="opt.key"
              [checked]="isSelected(opt.key)"
              [disabled]="disabled()"
              (change)="onToggle(opt.key)"
            />
            <span class="option-key">{{ opt.key }}</span>
            <span class="option-text">{{ opt.text }}</span>
          </label>
        }
      </fieldset>
    </div>
  `,
  styles: `
    .question-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 1.5rem;
      width: 100%;
    }

    .question-meta {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .topic-badge, .type-badge {
      font-size: 0.7rem;
      font-weight: 600;
      border-radius: 12px;
      padding: 0.2rem 0.65rem;
    }

    .topic-badge {
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #bfdbfe;
    }

    .type-badge {
      background: #f3f4f6;
      color: #6b7280;
      border: 1px solid #e5e7eb;
    }

    .question-text {
      font-size: 0.9rem;
      font-weight: 500;
      color: #111827;
      line-height: 1.6;
      margin: 0 0 1.25rem;
      white-space: pre-wrap;
    }

    .code-block {
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      font-size: 0.8rem;
      line-height: 1.55;
      overflow-x: auto;
      margin: 0 0 1.25rem;
      white-space: pre;
      font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    }

    .code-block code {
      background: none;
      color: inherit;
      font-size: inherit;
    }

    .options {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      border: none;
      padding: 0;
      margin: 0;
    }

    .option {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      cursor: pointer;
      transition: border-color .12s, background .12s;
      background: #fff;
    }

    .option:hover { border-color: #9ca3af; background: #f9fafb; }
    .option.selected { border-color: #2563eb; background: #eff6ff; }
    .option.correct  { border-color: #16a34a; background: #f0fdf4; }
    .option.wrong    { border-color: #dc2626; background: #fef2f2; }

    .option input {
      margin-top: 2px;
      flex-shrink: 0;
      accent-color: #2563eb;
      cursor: pointer;
    }

    .option-key {
      font-weight: 700;
      font-size: 0.82rem;
      color: #374151;
      min-width: 1rem;
      flex-shrink: 0;
    }

    .option-text {
      font-size: 0.84rem;
      color: #374151;
      line-height: 1.45;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }
  `,
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
