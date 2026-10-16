import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A source name: a known i18n key becomes translated text, anything else (an area name) is shown as is. */
@Component({
  selector: 'app-source-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (label()) {
      @case ('profile.source.lessons') { <ng-container i18n="@@profile.source.lessons">Lessons</ng-container> }
      @case ('profile.source.skillChecks') { <ng-container i18n="@@profile.source.skillChecks">Skill Checks</ng-container> }
      @case ('profile.source.concepts') { <ng-container i18n="@@profile.source.concepts">Concepts</ng-container> }
      @case ('profile.source.minutes') { <ng-container i18n="@@profile.source.minutes">Minutes</ng-container> }
      @case ('profile.source.dailyCards') { <ng-container i18n="@@profile.source.dailyCards">Daily cards</ng-container> }
      @case ('profile.source.badges') { <ng-container i18n="@@profile.source.badges">Badges</ng-container> }
      @case ('profile.source.trophies') { <ng-container i18n="@@profile.source.trophies">Trophies</ng-container> }
      @default { {{ label() }} }
    }
  `,
})
export class SourceLabel {
  label = input.required<string>();
}
