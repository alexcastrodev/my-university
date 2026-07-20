import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Course } from '../../models/course.model';

@Component({
  selector: 'app-course-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './course-view.html',
  styleUrl: './course-view.css',
})
export class CourseView {
  course = input.required<Course>();
}
