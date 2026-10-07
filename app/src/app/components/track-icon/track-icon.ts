import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Line icons (24px grid, stroke follows currentColor) for each track; unknown slugs get a book. */
@Component({
  selector: 'app-track-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (slug()) {
    @case ('java-exams') { <path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/> }
    @case ('java-concepts') { <path d="M6 2v2M10 2v2M14 2v2"/><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z"/><path d="M17 10h1a3 3 0 0 1 0 6h-1"/> }
    @case ('java-minute') { <circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/> }
    @case ('jvm-concepts') { <rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/> }
    @case ('testing-concepts') { <path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2"/><path d="M8.5 2h7M7 14h10"/> }
    @case ('spring-concepts') { <path d="M12 22v-9"/><path d="M12 13c0-4 3-7 8-7 0 4-3 7-8 7z"/><path d="M12 15c0-3-2.5-5-7-5 0 3 2.5 5 7 5z"/> }
    @case ('quarkus-concepts') { <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/> }
    @case ('ruby-concepts') { <path d="M6 3h12l4 6-10 12L2 9l4-6z"/><path d="M2 9h20M12 21 8 9l3-6M12 21l4-12-3-6"/> }
    @case ('rubyonrails-concepts') { <circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/> }
    @case ('dotnet-concepts') { <path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/> }
    @case ('dotnet-testing-concepts') { <path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2"/><path d="M8.5 2h7M7 14h10"/> }
    @case ('csharp-concepts') { <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/> }
    @case ('csharp-minute') { <circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/> }
    @case ('database-concepts') { <ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/> }
    @case ('system-design-concepts') { <rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-2a2 2 0 0 1 2-2h14v4M19 12v4"/> }
    @case ('kubernetes-concepts') { <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M12 14.5V21M4.2 7.5l5.6 3.2M14.2 13.3l5.6 3.2M4.2 16.5l5.6-3.2M14.2 10.7l5.6-3.2"/> }
    @case ('algorithms-concepts') { <path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/> }
    @case ('read') { <path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2V4z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8V4z"/> }
    @case ('practice') { <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/> }
    @case ('review') { <path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/> }
    @default { <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/> }
      }
    </svg>
  `,
})
export class TrackIcon {
  readonly slug = input.required<string>();
}
