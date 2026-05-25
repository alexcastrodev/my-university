import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CourseModule, Lesson } from '../../models/course.model';

@Component({
  selector: 'app-playlist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <aside class="playlist" aria-label="Course playlist">
      <div class="playlist-header">
        <div class="playlist-title-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="3" y1="18" x2="15" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span>Playlist</span>
        </div>
        <div class="playlist-search-box">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input type="search" placeholder="Search playlist" aria-label="Search within playlist" />
        </div>
        <div class="playlist-options">
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="skillChecksVisible" />
            <span>Skill Checks</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" checked />
            <span>Auto Play</span>
          </label>
        </div>
      </div>

      <ol class="modules-list" role="list">
        @for (mod of modules(); track mod.id) {
          <li class="module">
            <button
              class="module-header"
              [class.expanded]="mod.expanded"
              (click)="toggleModule(mod.id)"
              [attr.aria-expanded]="mod.expanded"
              [attr.aria-controls]="'module-' + mod.id"
              type="button"
            >
              <span class="module-number">{{ mod.id }}.</span>
              <span class="module-title">{{ mod.title }}</span>
              <svg
                class="chevron"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            @if (mod.expanded) {
              <ol [id]="'module-' + mod.id" class="lessons-list" role="list">
                @for (lesson of mod.lessons; track lesson.id) {
                  <li>
                    <button
                      class="lesson"
                      [class.active]="activeLesson() === lesson.id"
                      (click)="selectLesson(lesson)"
                      type="button"
                    >
                      <span
                        class="lesson-status-dot"
                        [class]="'dot-' + lesson.status"
                        aria-hidden="true"
                      ></span>
                      <span class="lesson-info">
                        <span class="lesson-title">{{ lesson.title }}</span>
                        @if (lesson.type === 'skill-check') {
                          <span class="skill-check-badge">{{ getSkillCheckLabel(lesson.status) }}</span>
                        }
                        @if (lesson.type === 'skill-check' && lesson.status === 'not-attempted') {
                          <span class="skill-check-sub">Score 80% or higher to Pass</span>
                        }
                      </span>
                      @if (lesson.duration) {
                        <span class="lesson-duration">{{ lesson.duration }}</span>
                      }
                      @if (lesson.status === 'new') {
                        <span class="new-badge" aria-label="New">New</span>
                      }
                    </button>
                  </li>
                }
              </ol>
            }
          </li>
        }
      </ol>

      <div class="playlist-footer">
        <span class="footer-label">Course Duration</span>
        <span class="footer-duration">40h 17m</span>
      </div>
    </aside>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .playlist {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #fff;
      border-left: 1px solid #e5e7eb;
    }

    .playlist-header {
      padding: 0.875rem 1rem 0.5rem;
      border-bottom: 1px solid #e5e7eb;
      flex-shrink: 0;
    }

    .playlist-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      font-weight: 600;
      color: #111;
      margin-bottom: 0.625rem;
    }

    .playlist-search-box {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 0.35rem 0.6rem;
      color: #9ca3af;
      margin-bottom: 0.5rem;
    }

    .playlist-search-box input {
      background: none;
      border: none;
      outline: none;
      font-size: 0.78rem;
      color: #374151;
      width: 100%;
    }

    .playlist-search-box input::placeholder {
      color: #9ca3af;
    }

    .playlist-options {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.75rem;
      color: #374151;
      cursor: pointer;
      user-select: none;
    }

    .checkbox-label input {
      accent-color: #c74634;
      cursor: pointer;
    }

    .modules-list {
      flex: 1;
      overflow-y: auto;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .module {
      border-bottom: 1px solid #f3f4f6;
    }

    .module-header {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      width: 100%;
      padding: 0.7rem 1rem;
      background: #f9fafb;
      border: none;
      cursor: pointer;
      text-align: left;
      font-size: 0.78rem;
      font-weight: 600;
      color: #111827;
      transition: background .15s;
    }

    .module-header:hover {
      background: #f3f4f6;
    }

    .module-number {
      flex-shrink: 0;
      color: #6b7280;
    }

    .module-title {
      flex: 1;
      line-height: 1.35;
    }

    .chevron {
      flex-shrink: 0;
      margin-top: 2px;
      color: #9ca3af;
      transition: transform .2s;
    }

    .module-header.expanded .chevron {
      transform: rotate(180deg);
    }

    .lessons-list {
      list-style: none;
      margin: 0;
      padding: 0;
      background: #fff;
    }

    .lesson {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      width: 100%;
      padding: 0.55rem 1rem 0.55rem 1.5rem;
      background: none;
      border: none;
      cursor: pointer;
      text-align: left;
      font-size: 0.75rem;
      color: #374151;
      transition: background .12s;
      border-left: 3px solid transparent;
    }

    .lesson:hover {
      background: #f9fafb;
    }

    .lesson.active {
      background: #fef2f0;
      border-left-color: #c74634;
      color: #c74634;
    }

    .lesson-status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 3px;
      border: 2px solid #d1d5db;
      background: transparent;
    }

    .dot-new {
      border-color: #d1d5db;
    }

    .dot-completed {
      border-color: #16a34a;
      background: #16a34a;
    }

    .dot-in-progress {
      border-color: #2563eb;
      background: #2563eb;
    }

    .dot-not-attempted {
      border-color: #f59e0b;
    }

    .lesson-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .lesson-title {
      line-height: 1.35;
    }

    .skill-check-badge {
      display: inline-block;
      font-size: 0.68rem;
      background: #f3f4f6;
      color: #6b7280;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 0.1rem 0.35rem;
      width: fit-content;
    }

    .skill-check-sub {
      font-size: 0.67rem;
      color: #9ca3af;
    }

    .lesson-duration {
      font-size: 0.7rem;
      color: #9ca3af;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .new-badge {
      font-size: 0.65rem;
      background: #c74634;
      color: #fff;
      border-radius: 4px;
      padding: 0.1rem 0.35rem;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .playlist-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.625rem 1rem;
      border-top: 1px solid #e5e7eb;
      background: #f9fafb;
      font-size: 0.75rem;
      color: #6b7280;
      flex-shrink: 0;
    }

    .footer-duration {
      font-weight: 600;
      color: #374151;
    }
  `,
})
export class Playlist {
  modules = input.required<CourseModule[]>();
  lessonSelected = output<Lesson>();
  moduleToggled = output<number>();

  activeLesson = signal<string | null>(null);
  skillChecksVisible = signal(true);

  toggleModule(id: number): void {
    this.moduleToggled.emit(id);
  }

  selectLesson(lesson: Lesson): void {
    this.activeLesson.set(lesson.id);
    this.lessonSelected.emit(lesson);
  }

  getSkillCheckLabel(status: string): string {
    if (status === 'not-attempted') return 'Not Attempted';
    if (status === 'completed') return 'Passed';
    return 'In Progress';
  }
}
