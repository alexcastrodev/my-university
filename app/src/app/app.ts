import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Header } from './components/header/header';
import { Playlist } from './components/playlist/playlist';
import { CourseView } from './components/course-view/course-view';
import { CourseService } from './services/course.service';
import { Course, Lesson } from './models/course.model';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Header, Playlist, CourseView],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private courseService = inject(CourseService);

  course = signal<Course>(this.courseService.getCourse());

  modules = computed(() => this.course().modules);

  onModuleToggled(moduleId: number): void {
    this.course.update((c) => ({
      ...c,
      modules: c.modules.map((m) =>
        m.id === moduleId ? { ...m, expanded: !m.expanded } : m,
      ),
    }));
  }

  onLessonSelected(lesson: Lesson): void {
    console.log('Selected lesson:', lesson.title);
  }
}
