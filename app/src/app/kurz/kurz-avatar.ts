import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The Kurz: a small round creature with big eyes, the "pet" the student asks. Drawn inline, no image to load. */
@Component({
  selector: 'app-kurz-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.5" cy="9.5" r="4" fill="#f2a93b" />
      <circle cx="25.5" cy="9.5" r="4" fill="#f2a93b" />
      <circle cx="16" cy="18" r="12.5" fill="#fbc55a" />
      <circle cx="11" cy="16.5" r="2.1" fill="#3b2a1a" />
      <circle cx="21" cy="16.5" r="2.1" fill="#3b2a1a" />
      <circle cx="11.7" cy="15.8" r="0.7" fill="#fff" />
      <circle cx="21.7" cy="15.8" r="0.7" fill="#fff" />
      <circle cx="7.6" cy="21" r="2" fill="#f58f6e" opacity="0.55" />
      <circle cx="24.4" cy="21" r="2" fill="#f58f6e" opacity="0.55" />
      <path
        d="M12.8 21.6c1.9 1.8 4.5 1.8 6.4 0"
        fill="none"
        stroke="#3b2a1a"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
      line-height: 0;
    }
  `,
})
export class KurzAvatar {
  size = input(24);
}
