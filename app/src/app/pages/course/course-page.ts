import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { BreadcrumbItem, Breadcrumbs } from '../../components/breadcrumbs/breadcrumbs';
import { CourseView } from '../../components/course-view/course-view';
import { LessonContent } from '../../components/lesson-content/lesson-content';
import { Playlist } from '../../components/playlist/playlist';
import { SkillCheckView } from '../../components/skill-check-view/skill-check-view';
import { Course, Lesson } from '../../models/course.model';
import { Exam } from '../../models/exam.model';
import { AuthService } from '../../services/auth.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-course-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CourseView, LessonContent, Playlist, RouterLink, SkillCheckView, Breadcrumbs],
  templateUrl: './course-page.html',
  styleUrl: './course-page.css',
})
export class CoursePage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  protected auth = inject(AuthService);
  private xpService = inject(XpService);
  private seo = inject(SeoService);
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
  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const course = this.course();
    if (!course) return [];
    const trail: BreadcrumbItem[] = [
      { name: 'Certification Exams', path: '/java/exams' },
      { name: course.title, path: `/java/exam/${course.id}` },
    ];
    const lesson = this.activeLesson();
    if (lesson) trail.push({ name: lesson.title, path: `/java/exam/${course.id}/lesson/${lesson.id}` });
    return trail;
  });

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
    void this.router.navigate(['/java/exam', this.examId(), 'lesson', lesson.id]);
    this.openLesson(lesson);
  }

  onSkillCheckCompleted(): void {
    const lesson = this.activeLesson();
    if (!lesson || !this.auth.currentUser()) return;

    const status = 'completed';
    this.http
      .put(`/api/progress/${this.examId()}/${lesson.id}`, { status })
      .subscribe({
        next: () => { this.setLessonStatus(lesson.id, status); this.xpService.loadSummary(); },
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
      this.setCourseSeo();
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
    this.setLessonSeo(lesson);
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
    void this.router.navigate(['/java/exam', this.examId()]);
    this.activeLesson.set(null);
    this.activeLessonId.set(null);
    this.markdownContent.set(null);
    this.setCourseSeo();
  }

  private setCourseSeo(): void {
    const course = this.course();
    if (!course) return;
    this.seo.set({
      title: `${course.title} — My University`,
      description: course.description,
      path: `/java/exam/${course.id}`,
      course: { moduleCount: course.moduleCount },
      breadcrumbs: this.breadcrumbItems(),
    });
  }

  private setLessonSeo(lesson: Lesson): void {
    const course = this.course();
    if (!course) return;
    this.seo.set({
      title: `${lesson.title} — ${course.title}`,
      description: `${lesson.title} — a lesson from the ${course.title} course on My University.`,
      path: `/java/exam/${course.id}/lesson/${lesson.id}`,
      type: 'article',
      breadcrumbs: this.breadcrumbItems(),
    });
  }

  toggleCompleted(): void {
    const lesson = this.activeLesson();
    if (!lesson || !this.auth.currentUser()) return;

    const status = lesson.status === 'completed' ? 'in-progress' : 'completed';
    this.http
      .put(`/api/progress/${this.examId()}/${lesson.id}`, { status })
      .subscribe({
        next: () => {
          this.setLessonStatus(lesson.id, status);
          if (status === 'completed') this.xpService.loadSummary();
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
    this.http.get<Course>(`/api/courses/${id}`).subscribe({
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
