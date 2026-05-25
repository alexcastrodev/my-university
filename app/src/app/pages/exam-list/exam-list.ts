import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Exam } from '../../models/exam.model';
import { ExamService } from '../../services/exam.service';

@Component({
  selector: 'app-exam-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="page">
      <div class="page-hero">
        <h1 class="page-title">Certification Exams</h1>
        <p class="page-sub">Choose an exam to start practising. Questions are randomised every session.</p>
      </div>

      <div class="page-body">
        @if (loading()) {
          <div class="loading" role="status" aria-label="Loading exams">
            <span class="spinner" aria-hidden="true"></span>
            Loading exams…
          </div>
        } @else {
          @for (category of categories(); track category) {
            <section class="category-section">
              <h2 class="category-title">
                <span class="category-icon" aria-hidden="true">{{ categoryIcon(category) }}</span>
                {{ category }}
              </h2>
              <div class="cards-grid">
                @for (exam of byCategory(category); track exam.id) {
                  <a [routerLink]="['/exam', exam.id]" class="exam-card">
                    <div class="card-header">
                      <span class="card-version">v{{ exam.version }}</span>
                      <span class="card-category">{{ exam.category }}</span>
                    </div>
                    <h3 class="card-title">{{ exam.title }}</h3>
                    <div class="card-meta">
                      <span>{{ exam.questionCount }} questions</span>
                      <span>{{ exam.durationMinutes }} minutes</span>
                      <span>{{ exam.passingScore }}% pass</span>
                    </div>
                    <div class="card-footer">
                      <span class="card-cta">Start Practice →</span>
                    </div>
                  </a>
                }
              </div>
            </section>
          }
        }
      </div>
    </div>
  `,
  styles: `
    .page {
      min-height: calc(100vh - 52px);
      background: #f9fafb;
    }

    .page-hero {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      padding: 3rem 2rem 2.5rem;
      text-align: center;
    }

    .page-title {
      font-size: 2rem;
      font-weight: 700;
      color: #fff;
      margin: 0 0 0.5rem;
    }

    .page-sub {
      font-size: 0.9rem;
      color: rgba(255,255,255,.65);
      margin: 0;
    }

    .page-body {
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: #6b7280;
      font-size: 0.9rem;
      padding: 3rem;
      justify-content: center;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid #e5e7eb;
      border-top-color: #c74634;
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .category-section {
      margin-bottom: 2.5rem;
    }

    .category-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1rem;
      font-weight: 700;
      color: #111827;
      margin: 0 0 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #e5e7eb;
    }

    .category-icon {
      font-size: 1.1rem;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1rem;
    }

    .exam-card {
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 1.25rem;
      text-decoration: none;
      color: inherit;
      transition: border-color .15s, box-shadow .15s, transform .15s;
      cursor: pointer;
    }

    .exam-card:hover {
      border-color: #c74634;
      box-shadow: 0 4px 16px rgba(199,70,52,.12);
      transform: translateY(-2px);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }

    .card-version {
      font-size: 0.7rem;
      font-weight: 700;
      color: #fff;
      background: #c74634;
      border-radius: 12px;
      padding: 0.15rem 0.55rem;
    }

    .card-category {
      font-size: 0.7rem;
      color: #6b7280;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 0.15rem 0.55rem;
    }

    .card-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: #111827;
      margin: 0;
      flex: 1;
      line-height: 1.4;
    }

    .card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.75rem;
    }

    .card-meta span {
      font-size: 0.68rem;
      color: #4b5563;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 0.15rem 0.45rem;
    }

    .card-footer {
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid #f3f4f6;
    }

    .card-cta {
      font-size: 0.78rem;
      font-weight: 600;
      color: #c74634;
    }
  `,
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
