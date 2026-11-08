import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Bookmark } from '../../models/bookmark.model';
import { ResumePoint } from '../../models/course.model';
import { AuthService } from '../../services/auth.service';
import { BookmarkService } from '../../services/bookmark.service';
import { ResumeService } from '../../services/resume.service';
import { SeoService } from '../../services/seo.service';
import { areaLabel } from '../../shared/area-labels';

/**
 * Where the reader left off in each module: the bookmark they placed, one per module, and the next
 * lesson of the course (which needs no bookmark, the course already knows how far they got).
 */
@Component({
  selector: 'app-bookmarks-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './bookmarks-page.html',
  styleUrl: './bookmarks-page.css',
})
export class BookmarksPage implements OnInit {
  protected auth = inject(AuthService);
  protected bookmarkService = inject(BookmarkService);
  private resumeService = inject(ResumeService);
  private seo = inject(SeoService);

  private resume = signal<ResumePoint | null>(null);

  protected course = computed(() => {
    const point = this.resume();
    if (!point) return null;
    return {
      title: point.courseTitle,
      lesson: point.lessonTitle,
      route: point.lessonId ? ['/java/exam', point.courseId, 'lesson', point.lessonId] : ['/java/exam', point.courseId],
    };
  });

  constructor() {
    effect(() => {
      if (!this.auth.currentUser()) return;
      this.resumeService.getResumePoint().subscribe({
        next: (point) => this.resume.set(point),
        error: () => this.resume.set(null),
      });
    });
  }

  ngOnInit(): void {
    this.seo.set({
      title: 'Bookmarks',
      description: 'Where you left off in each module.',
      path: '/bookmarks',
      noindex: true,
    });
  }

  protected areaOf(bookmark: Bookmark): string {
    return areaLabel(bookmark.module, bookmark.discipline);
  }
}
