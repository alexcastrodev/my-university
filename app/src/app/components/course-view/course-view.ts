import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Course } from '../../models/course.model';

@Component({
  selector: 'app-course-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (course(); as c) {
      <div class="course-view">
        <div class="hero">
          <div class="hero-content">
            <h1 class="course-title">{{ c.title }}</h1>
            <div class="course-meta" role="list">
              <span class="meta-item" role="listitem">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  <circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                </svg>
                {{ c.audience }}
              </span>
              <span class="meta-item" role="listitem">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                  <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="2"/>
                  <line x1="9" y1="21" x2="9" y2="9" stroke="currentColor" stroke-width="2"/>
                </svg>
                {{ c.moduleCount }} Modules
              </span>
              <span class="meta-item" role="listitem">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                  <polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {{ c.duration }}
              </span>
            </div>
          </div>
          <div class="hero-player" aria-label="Course preview video">
            <div class="play-button" role="button" tabindex="0" aria-label="Play course overview">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" fill="white"/>
              </svg>
            </div>
            <div class="hero-overlay" aria-hidden="true"></div>
          </div>
        </div>

        <div class="course-body">
          <div class="course-info">
            <div class="course-header-info">
              <h2 class="course-title-sm">{{ c.title }}</h2>
              <span class="course-tag">{{ c.tag }}</span>
              <div class="action-row" aria-label="Course actions">
                <button class="icon-btn" aria-label="Add to favorites" type="button">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button class="icon-btn" aria-label="Share course" type="button">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="2"/>
                    <circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                    <circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="2"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>

            <div class="description-section">
              <p class="description">{{ c.description }}</p>

              <div class="course-info-cards" role="list">
                <div class="info-card" role="listitem">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
                  </svg>
                  <div>
                    <span class="info-label">Audience</span>
                    <span class="info-value">{{ c.audience }}</span>
                  </div>
                </div>
                <div class="info-card" role="listitem">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                    <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="2"/>
                    <line x1="9" y1="21" x2="9" y2="9" stroke="currentColor" stroke-width="2"/>
                  </svg>
                  <div>
                    <span class="info-label">Number of Modules</span>
                    <span class="info-value">{{ c.moduleCount }}</span>
                  </div>
                </div>
                <div class="info-card" role="listitem">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                    <polyline points="12 6 12 12 16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  <div>
                    <span class="info-label">Course Duration</span>
                    <span class="info-value">{{ c.duration }}</span>
                  </div>
                </div>
              </div>
            </div>

            <ng-content></ng-content>

            <div class="benefits-section">
              <h3>Benefits to you</h3>
              <p class="benefits-intro">After completing this course, you should be able to:</p>
              <ul class="benefits-list" role="list">
                @for (benefit of c.benefits; track benefit) {
                  <li class="benefit-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" stroke="#c74634" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    {{ benefit }}
                  </li>
                }
              </ul>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .course-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
      background: #fff;
    }

    .hero {
      position: relative;
      background: linear-gradient(135deg, #2d1f1a 0%, #3d2415 40%, #4a3020 100%);
      min-height: 240px;
      display: flex;
      align-items: flex-end;
      overflow: hidden;
    }

    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse at 20% 80%, rgba(180,90,30,.4) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 20%, rgba(100,60,20,.3) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 70%, rgba(200,100,50,.25) 0%, transparent 40%);
    }

    .hero-content {
      position: relative;
      z-index: 2;
      padding: 2rem 1.5rem 1.5rem;
    }

    .course-title {
      font-size: 1.6rem;
      font-weight: 700;
      color: #fff;
      margin: 0 0 0.75rem;
      line-height: 1.2;
    }

    .course-meta {
      display: flex;
      gap: 1.25rem;
      flex-wrap: wrap;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      color: rgba(255,255,255,.8);
    }

    .hero-player {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    }

    .hero-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,.2);
    }

    .play-button {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(0,0,0,.55);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform .2s, background .2s;
      position: relative;
      z-index: 2;
      border: 2px solid rgba(255,255,255,.3);
    }

    .play-button:hover,
    .play-button:focus-visible {
      transform: scale(1.08);
      background: rgba(0,0,0,.75);
      outline: 2px solid rgba(255,255,255,.6);
    }

    .course-body {
      flex: 1;
      padding: 1.75rem 2rem 2.5rem;
    }

    .course-header-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }

    .course-title-sm {
      font-size: 1rem;
      font-weight: 700;
      color: #111827;
      margin: 0;
      flex: 1;
      min-width: 0;
    }

    .course-tag {
      font-size: 0.72rem;
      font-weight: 600;
      color: #c74634;
      background: #fef2f0;
      border: 1px solid #fca99a;
      border-radius: 12px;
      padding: 0.2rem 0.65rem;
      white-space: nowrap;
    }

    .action-row {
      display: flex;
      gap: 0.25rem;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #6b7280;
      padding: 0.35rem;
      border-radius: 6px;
      display: flex;
      align-items: center;
      transition: background .15s, color .15s;
    }

    .icon-btn:hover {
      background: #f3f4f6;
      color: #111827;
    }

    .description {
      font-size: 0.82rem;
      color: #4b5563;
      line-height: 1.65;
      margin: 0 0 1.5rem;
    }

    .course-info-cards {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 2rem;
    }

    .info-card {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 0.625rem 0.875rem;
      color: #374151;
      flex: 1;
      min-width: 120px;
    }

    .info-card svg {
      color: #6b7280;
      flex-shrink: 0;
    }

    .info-card > div {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }

    .info-label {
      font-size: 0.68rem;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: .05em;
    }

    .info-value {
      font-size: 0.8rem;
      font-weight: 600;
      color: #111827;
    }

    .benefits-section {
      padding-top: 0.25rem;
    }

    .benefits-section h3 {
      font-size: 0.9rem;
      font-weight: 700;
      color: #111827;
      margin: 0 0 0.4rem;
    }

    .benefits-intro {
      font-size: 0.8rem;
      color: #6b7280;
      margin: 0 0 0.75rem;
    }

    .benefits-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .benefit-item {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: #374151;
      line-height: 1.45;
    }

    .benefit-item svg {
      flex-shrink: 0;
      margin-top: 3px;
    }
  `,
})
export class CourseView {
  course = input.required<Course>();
}
