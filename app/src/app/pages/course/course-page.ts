import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CourseView } from '../../components/course-view/course-view';
import { LessonContent } from '../../components/lesson-content/lesson-content';
import { Playlist } from '../../components/playlist/playlist';
import { SkillCheckView } from '../../components/skill-check-view/skill-check-view';
import { Course, Lesson } from '../../models/course.model';
import { Exam } from '../../models/exam.model';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-course-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CourseView, LessonContent, Playlist, RouterLink, SkillCheckView],
  template: `
    @if (loading()) {
      <div class="loading" role="status">
        <span class="spinner" aria-hidden="true"></span>
        Loading course…
      </div>
    } @else if (course()) {
      <div class="layout">
        <main class="main-content" id="main-content" tabindex="-1">
          @if (activeLesson()) {
            <div class="lesson-header">
              <button class="back-btn" (click)="clearLesson()" type="button">
                ← Back to course
              </button>
              <span class="lesson-title-bar">{{ activeLesson()!.title }}</span>
              <button
                class="complete-btn"
                [class.completed]="activeLesson()!.status === 'completed'"
                [class.locked]="!auth.currentUser()"
                [disabled]="!auth.currentUser()"
                [attr.title]="!auth.currentUser() ? 'Log in to mark this lesson as completed' : null"
                [attr.aria-label]="!auth.currentUser() ? 'Log in to mark this lesson as completed' : null"
                (click)="toggleCompleted()"
                type="button"
              >
                @if (!auth.currentUser()) {
                  <span aria-hidden="true">🔒</span>
                }
                {{ activeLesson()!.status === 'completed' ? 'Completed' : 'Mark completed' }}
              </button>
            </div>
            @if (markdownLoading()) {
              <div class="loading" role="status">
                <span class="spinner" aria-hidden="true"></span>
                Loading lesson…
              </div>
            } @else if (isPracticePlaceholder()) {
              <div class="practice-placeholder">
                <div class="practice-icon" aria-hidden="true">✏️</div>
                <p class="practice-desc">Work through the practice exercises for this topic on your own. When you're done, mark this lesson as completed.</p>
              </div>
            } @else if (activeLesson()!.type === 'skill-check') {
              <app-skill-check-view
                [examId]="examId()"
                [topic]="activeLesson()!.topic!"
                [lessonId]="activeLesson()!.id"
                (completed)="onSkillCheckCompleted()"
              ></app-skill-check-view>
            } @else {
              <app-lesson-content [lessonContent]="markdownContent()"></app-lesson-content>
            }
          } @else {
            <app-course-view [course]="course()!">
              <div class="quiz-banner">
                <div class="quiz-banner-text">
                  <strong>Ready to test your knowledge?</strong>
                  <span>{{ questionCount() }} questions · {{ durationMinutes() }} minutes · {{ passingScore() }}% passing score</span>
                </div>
                <a [routerLink]="['/exam', examId(), 'quiz']" class="quiz-btn">
                  Start Practice Exam →
                </a>
              </div>
            </app-course-view>
          }
        </main>
        <app-playlist
          [modules]="modules()"
          [activeLessonId]="activeLessonId()"
          (lessonSelected)="onLessonSelected($event)"
          (moduleToggled)="onModuleToggled($event)"
        ></app-playlist>
      </div>
    } @else {
      <div class="error">Course not found.</div>
    }
  `,
  styles: `
    .loading, .error {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      height: calc(100vh - 52px);
      color: #6b7280;
      font-size: 0.9rem;
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

    .layout {
      display: grid;
      grid-template-columns: 1fr 300px;
      height: calc(100vh - 52px);
      overflow: hidden;
    }

    .main-content {
      overflow-y: auto;
      min-height: 0;
      outline: none;
    }

    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr auto;
        height: auto;
        min-height: calc(100vh - 52px);
        overflow: visible;
      }

      .main-content {
        overflow-y: visible;
      }
    }

    .quiz-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      background: linear-gradient(90deg, #1a1a2e, #0f3460);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin: 0 0 2rem;
      flex-wrap: wrap;
    }

    .quiz-banner-text {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      color: #fff;
    }

    .quiz-banner-text strong {
      font-size: 0.875rem;
    }

    .quiz-banner-text span {
      font-size: 0.78rem;
      color: rgba(255,255,255,.65);
    }

    .quiz-btn {
      background: #c74634;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.5rem 1rem;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      transition: opacity .15s;
    }

    .quiz-btn:hover {
      opacity: .88;
    }

    .lesson-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
      flex-shrink: 0;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.8rem;
      color: #6b7280;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      transition: background .12s, color .12s;
      white-space: nowrap;
    }

    .back-btn:hover {
      background: #e5e7eb;
      color: #111827;
    }

    .lesson-title-bar {
      font-size: 0.85rem;
      font-weight: 600;
      color: #111827;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .complete-btn {
      background: #fff;
      border: 1px solid #d1d5db;
      color: #374151;
      border-radius: 6px;
      padding: 0.35rem 0.65rem;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background .12s, border-color .12s, color .12s;
    }

    .complete-btn:hover {
      background: #f3f4f6;
      border-color: #9ca3af;
    }

    .complete-btn.completed {
      background: #ecfdf5;
      border-color: #16a34a;
      color: #166534;
    }

    .complete-btn:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .complete-btn.locked {
      background: #f9fafb;
      color: #6b7280;
      border-style: dashed;
    }

    .complete-btn.locked:hover {
      background: #f9fafb;
      border-color: #d1d5db;
    }

    .practice-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 4rem 2rem;
      text-align: center;
      max-width: 480px;
      margin: 0 auto;
    }

    .practice-icon { font-size: 2.5rem; line-height: 1; }

    .practice-desc {
      font-size: 0.875rem;
      color: #6b7280;
      line-height: 1.6;
      margin: 0;
    }

  `,
})
export class CoursePage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  protected auth = inject(AuthService);
  private xpService = inject(XpService);
  private courseLoader = effect(() => {
    const id = this.examId();
    this.auth.currentUser();
    if (id) this.loadCourse(id);
  });

  examId = signal('');
  course = signal<Course | null>(null);
  loading = signal(true);
  questionCount = signal(0);
  durationMinutes = signal(0);
  passingScore = signal(0);

  activeLesson = signal<Lesson | null>(null);
  activeLessonId = signal<string | null>(null);
  markdownContent = signal<{ content: string; version: string | null; updatedAt: string | null } | null>(null);

  private parseFrontmatter(raw: string): { content: string; version: string | null; updatedAt: string | null } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { content: raw, version: null, updatedAt: null };
    const fm = match[1];
    const version = fm.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? null;
    const updatedAt = fm.match(/^updatedAt:\s*(.+)$/m)?.[1]?.trim() ?? null;
    return { content: match[2], version, updatedAt };
  }
  markdownLoading = signal(false);

  modules = computed(() => this.course()?.modules ?? []);
  isPracticePlaceholder = computed(() => this.activeLesson()?.type === 'practice' && !this.markdownContent());

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('examId') ?? '';
    this.examId.set(id);

    this.route.paramMap.subscribe((params) => {
      const lessonId = params.get('lessonId');
      if (this.course()) {
        this.activateLessonFromUrl(lessonId);
      }
    });

    this.http.get<Exam>(`/api/exam/${id}`).subscribe({
      next: (exam) => {
        this.questionCount.set(exam.questionCount);
        this.durationMinutes.set(exam.durationMinutes);
        this.passingScore.set(exam.passingScore);
      },
    });
  }

  onModuleToggled(moduleId: number): void {
    this.course.update((c) => c ? ({
      ...c,
      modules: c.modules.map((m) => m.id === moduleId ? { ...m, expanded: !m.expanded } : m),
    }) : c);
  }

  onLessonSelected(lesson: Lesson): void {
    void this.router.navigate(['/exam', this.examId(), 'lesson', lesson.id]);
    this.openLesson(lesson);
  }

  onSkillCheckCompleted(): void {
    const lesson = this.activeLesson();
    if (!lesson || !this.auth.currentUser()) return;

    const status = 'completed';
    this.http
      .put(`/api/progress/${this.examId()}/${lesson.id}`, { status }, this.auth.headers())
      .subscribe({
        next: () => { this.setLessonStatus(lesson.id, status); this.xpService.loadXp(); },
        error: (err) => {
          if (err.status === 401) {
            this.auth.logout();
            void this.router.navigate(['/login']);
          }
        },
      });
  }

  private activateLessonFromUrl(lessonId: string | null): void {
    if (!lessonId) {
      this.activeLesson.set(null);
      this.activeLessonId.set(null);
      this.markdownContent.set(null);
      return;
    }

    const lesson = this.findLesson(lessonId);
    if (lesson) {
      this.expandModuleForLesson(lessonId);
      this.openLesson(lesson);
    }
  }

  private openLesson(lesson: Lesson): void {
    if (this.activeLessonId() === lesson.id && this.markdownContent()) return;

    this.activeLesson.set(lesson);
    this.activeLessonId.set(lesson.id);
    if (!lesson.contentPath) {
      this.markdownContent.set(null);
      return;
    }
    this.markdownLoading.set(true);
    this.http.get(`/api/content/${lesson.contentPath}`, { responseType: 'text' }).subscribe({
      next: (raw) => { this.markdownContent.set(this.parseFrontmatter(raw)); this.markdownLoading.set(false); },
      error: () => { this.markdownContent.set(null); this.markdownLoading.set(false); },
    });
  }

  clearLesson(): void {
    void this.router.navigate(['/exam', this.examId()]);
    this.activeLesson.set(null);
    this.activeLessonId.set(null);
    this.markdownContent.set(null);
  }

  toggleCompleted(): void {
    const lesson = this.activeLesson();
    if (!lesson || !this.auth.currentUser()) return;

    const status = lesson.status === 'completed' ? 'in-progress' : 'completed';
    this.http
      .put(`/api/progress/${this.examId()}/${lesson.id}`, { status }, this.auth.headers())
      .subscribe({
        next: () => {
          this.setLessonStatus(lesson.id, status);
          if (status === 'completed') this.xpService.loadXp();
        },
        error: (err) => {
          if (err.status === 401) {
            this.auth.logout();
            void this.router.navigate(['/login']);
          }
        },
      });
  }

  private findLesson(lessonId: string): Lesson | null {
    for (const mod of this.modules()) {
      const lesson = mod.lessons.find((item) => item.id === lessonId);
      if (lesson) return lesson;
    }
    return null;
  }

  private expandModuleForLesson(lessonId: string): void {
    this.course.update((c) => c ? ({
      ...c,
      modules: c.modules.map((m) => ({
        ...m,
        expanded: m.expanded || m.lessons.some((lesson) => lesson.id === lessonId),
      })),
    }) : c);
  }

  private withExpandedModule(course: Course, lessonId: string | null): Course {
    return {
      ...course,
      modules: course.modules.map((m, index) => ({
        ...m,
        expanded: Boolean(m.expanded) || (lessonId ? m.lessons.some((lesson) => lesson.id === lessonId) : index === 0),
      })),
    };
  }

  private setLessonStatus(lessonId: string, status: Lesson['status']): void {
    this.course.update((course) => course ? ({
      ...course,
      modules: course.modules.map((mod) => ({
        ...mod,
        lessons: mod.lessons.map((lesson) => lesson.id === lessonId ? { ...lesson, status } : lesson),
      })),
    }) : course);

    this.activeLesson.update((lesson) => lesson?.id === lessonId ? { ...lesson, status } : lesson);
  }

  private loadCourse(id: string): void {
    this.loading.set(true);
    this.http.get<Course>(`/api/courses/${id}`, this.auth.headers()).subscribe({
      next: (c) => {
        const lessonId = this.route.snapshot.paramMap.get('lessonId');
        this.course.set(this.withExpandedModule(c, lessonId));
        this.loading.set(false);
        this.activateLessonFromUrl(lessonId);
      },
      error: () => { this.loading.set(false); },
    });
  }
}
