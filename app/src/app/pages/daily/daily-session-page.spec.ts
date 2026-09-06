import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DailySession } from '../../models/daily.model';
import { AuthService } from '../../services/auth.service';
import { DailySessionService } from '../../services/daily-session.service';
import { XpService } from '../../services/xp.service';
import { DailySessionPage } from './daily-session-page';

const SESSION: DailySession = {
  estimatedMinutes: 5,
  summary: { headline: 'You renewed a mark', tomorrow: { title: 'ThreadLocal', body: 'It depends.' } },
  cards: [
    {
      type: 'recall',
      xp: 20,
      previewTitle: 'Reference reachability',
      previewSubtitle: 'Marked in March',
      recap: 'Recall · reference reachability',
      kicker: 'RECALL · NO LOOKING BACK',
      title: 'When does a weakly reachable object become collectable?',
      options: ['When the GC runs', 'When no strong reference exists', 'When the map is cleared'],
      correctIndex: 1,
    },
    {
      type: 'write',
      xp: 20,
      previewTitle: 'One line',
      previewSubtitle: 'Kept next to March',
      recap: 'Write · answer saved',
      kicker: 'WRITE · ONE LINE',
      title: 'In your own words: who decides?',
      maxLength: 240,
    },
  ],
};

function setup() {
  TestBed.configureTestingModule({
    imports: [DailySessionPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(null) } },
      { provide: DailySessionService, useValue: { build: () => of(SESSION) } },
      {
        provide: XpService,
        useValue: {
          summary: signal(null),
          streak: signal(null),
          loadSummary: () => {},
          loadStreak: () => {},
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DailySessionPage);
  fixture.detectChanges();
  return fixture;
}

function primaryButton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.card-foot .primary-btn') as HTMLButtonElement;
}

describe('DailySessionPage', () => {
  it('opens on the first card with a segmented progress bar', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.count').textContent).toContain('1/2');
    expect(fixture.nativeElement.querySelectorAll('.seg').length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('RECALL · NO LOOKING BACK');
  });

  it('keeps Check disabled until an option is picked', () => {
    const fixture = setup();

    expect(primaryButton(fixture).disabled).toBe(true);

    fixture.nativeElement.querySelectorAll('.option')[1].click();
    fixture.detectChanges();

    expect(primaryButton(fixture).disabled).toBe(false);
  });

  it('reveals the correct and wrong options after Check', () => {
    const fixture = setup();

    fixture.nativeElement.querySelectorAll('.option')[0].click(); // wrong
    fixture.detectChanges();
    primaryButton(fixture).click(); // Check
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.option.state-correct')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.option.state-wrong')).toBeTruthy();
  });

  it('advances to the write card and then to the done screen', () => {
    const fixture = setup();

    fixture.nativeElement.querySelectorAll('.option')[1].click();
    fixture.detectChanges();
    primaryButton(fixture).click(); // Check
    fixture.detectChanges();
    primaryButton(fixture).click(); // Next → card 2
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.count').textContent).toContain('2/2');
    expect(fixture.nativeElement.querySelector('.write-input')).toBeTruthy();

    primaryButton(fixture).click(); // Save and finish → done
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.done')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.done-headline').textContent).toContain('You renewed a mark');
    expect(fixture.nativeElement.querySelectorAll('.recap-row').length).toBe(2);
  });

  it('restarts from the done screen with Keep going', () => {
    const fixture = setup();

    // Run through both cards to reach the done screen.
    fixture.nativeElement.querySelectorAll('.option')[1].click();
    fixture.detectChanges();
    primaryButton(fixture).click(); // Check
    fixture.detectChanges();
    primaryButton(fixture).click(); // Next → card 2
    fixture.detectChanges();
    primaryButton(fixture).click(); // Save and finish → done
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.done')).toBeTruthy();

    fixture.nativeElement.querySelector('.done-ghost').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.count').textContent).toContain('1/2');
  });
});
