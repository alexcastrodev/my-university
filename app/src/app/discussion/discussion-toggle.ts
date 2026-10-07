import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DiscussionService } from './discussion.service';

/** The "Markers" switch in the top bar of a concept page. Only exists where discussions do. */
@Component({
  selector: 'app-discussion-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (discussion.available()) {
      <button
        type="button"
        class="toggle"
        role="switch"
        [attr.aria-checked]="discussion.enabled()"
        (click)="discussion.toggle()"
      >
        <span class="label" i18n="@@discussion.toggle">Markers</span>
        @if (discussion.totalComments() > 0) {
          <span class="count">· {{ discussion.totalComments() }}</span>
        }
        <span class="track" aria-hidden="true"><i></i></span>
      </button>
    }
  `,
  styles: `
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 0.35rem 0.3rem 0.75rem;
      border: 1px solid var(--mu-line);
      border-radius: 999px;
      background: var(--mu-surface);
      color: var(--mu-ink-soft);
      font-family: inherit;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
    }
    .toggle:hover { border-color: var(--mu-divider); }
    .count { color: var(--mu-muted); }
    .track {
      width: 34px;
      height: 20px;
      border-radius: 999px;
      background: var(--mu-divider);
      padding: 2px;
      transition: background 0.15s;
    }
    .track i {
      display: block;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--mu-white);
      transition: transform 0.15s;
    }
    .toggle[aria-checked='true'] .track { background: var(--mu-accent); }
    .toggle[aria-checked='true'] .track i { transform: translateX(14px); }
  `,
})
export class DiscussionToggle {
  protected discussion = inject(DiscussionService);
}
