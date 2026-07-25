import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CourseModule, Lesson } from '../../models/course.model';

@Component({
  selector: 'app-playlist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './playlist.html',
  styleUrl: './playlist.css',
})
export class Playlist {
  modules = input.required<CourseModule[]>();
  activeLessonId = input<string | null>(null);
  lessonSelected = output<Lesson>();
  moduleToggled = output<number>();

  skillChecksVisible = signal(true);
  searchQuery = signal('');

  filteredModules = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return this.modules();

    return this.modules()
      .map((mod) => ({
        ...mod,
        lessons: mod.lessons.filter((lesson) => lesson.title.toLowerCase().includes(query)),
      }))
      .filter((mod) => mod.lessons.length > 0);
  });

  isModuleExpanded(mod: CourseModule): boolean {
    return mod.expanded || this.searchQuery().trim().length > 0;
  }

  toggleModule(id: number): void {
    this.moduleToggled.emit(id);
  }

  selectLesson(lesson: Lesson): void {
    this.lessonSelected.emit(lesson);
  }

  getSkillCheckLabel(status: string): string {
    if (status === 'not-attempted') return 'Not Attempted';
    if (status === 'completed') return 'Passed';
    return 'In Progress';
  }
}
