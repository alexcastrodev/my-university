import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
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
