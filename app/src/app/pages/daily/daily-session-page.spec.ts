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
      context: 'You marked this as "Got it" before. Does it still hold?',
      sourceType: 'concept-read',
      sourceId: 'reference-reachability',
      route: ['/java/java-concepts', 'reference-reachability'],
      wrongNote: 'Getting it wrong is not a penalty.',
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
      sourceId: 'reference-reachability',
    },
  ],
};

const EMPTY_SESSION: DailySession = {
  estimatedMinutes: 1,
  summary: {
    headline: 'Nothing to review yet',
    tomorrow: { title: 'Read one concept first', body: 'A session assembles itself from it.' },
  },
  cards: [],
};

function setup(session: DailySession = SESSION, completeSpy = jasmine.createSpy('complete').and.returnValue(of({ xpAwarded: 20 }))) {
  TestBed.configureTestingModule({
    imports: [DailySessionPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(null) } },
      { provide: DailySessionService, useValue: { build: () => of(session), complete: completeSpy } },
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

  it('hides Next until Recall is answered, then reveals it on "I remember"', () => {
    const fixture = setup();

    expect(primaryButton(fixture)).toBeFalsy();

    const options = fixture.nativeElement.querySelectorAll('.options button');
    (options[0] as HTMLButtonElement).click(); // I remember
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.option.state-correct')).toBeTruthy();
    expect(primaryButton(fixture)).toBeTruthy();
  });

  it('shows the reassurance note and the reopen link on "I do not remember"', () => {
    const fixture = setup();

    const options = fixture.nativeElement.querySelectorAll('.options button');
    (options[1] as HTMLButtonElement).click(); // I do not remember
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.option.state-wrong')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.reassure').textContent).toContain('not a penalty');
    expect(fixture.nativeElement.querySelector('.ghost-link[href]')).toBeTruthy();
  });

  it('advances to the write card and then to the done screen', () => {
    const fixture = setup();

    fixture.nativeElement.querySelectorAll('.options button')[0].click(); // I remember
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

    fixture.nativeElement.querySelectorAll('.options button')[0].click();
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

  it('posts the recall rating when logged in', () => {
    const completeSpy = jasmine.createSpy('complete').and.returnValue(of({ xpAwarded: 20 }));
    TestBed.configureTestingModule({
      imports: [DailySessionPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 1 }) } },
        { provide: DailySessionService, useValue: { build: () => of(SESSION), complete: completeSpy } },
        {
          provide: XpService,
          useValue: { summary: signal(null), streak: signal(null), loadSummary: () => {}, loadStreak: () => {} },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DailySessionPage);
    fixture.detectChanges();

    fixture.nativeElement.querySelectorAll('.options button')[0].click(); // I remember
    fixture.detectChanges();

    expect(completeSpy).toHaveBeenCalledWith('recall', 'reference-reachability', {
      sourceType: 'concept-read',
      rating: 'good',
    });
  });

  it('completes Read and Notice independently even when they share a sourceId (Notice falls back to reusing Read\'s concept)', () => {
    const completeSpy = jasmine.createSpy('complete').and.returnValue(of({ xpAwarded: 20 }));
    const sharedSourceSession: DailySession = {
      estimatedMinutes: 5,
      summary: { headline: 'Today', tomorrow: { title: 'Next', body: 'Soon.' } },
      cards: [
        {
          type: 'read',
          xp: 20,
          previewTitle: 'WeakHashMap',
          previewSubtitle: 'Recent',
          recap: 'Read · WeakHashMap',
          kicker: 'READ · ONE SCREEN',
          title: 'The WeakHashMap Class',
          body: 'Body text.',
          fullTopicRoute: ['/java/java-concepts', 'weak-hash-map'],
          sourceId: 'weak-hash-map',
        },
        {
          type: 'notice',
          xp: 20,
          previewTitle: 'WeakHashMap',
          previewSubtitle: 'Recent',
          recap: 'Notice · WeakHashMap',
          kicker: 'NOTICE · FROM THE REAL SOURCE',
          title: 'The WeakHashMap Class',
          code: { header: 'WEAKHASHMAP', source: 'code' },
          sourceId: 'weak-hash-map',
        },
      ],
    };
    TestBed.configureTestingModule({
      imports: [DailySessionPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 1 }) } },
        { provide: DailySessionService, useValue: { build: () => of(sharedSourceSession), complete: completeSpy } },
        {
          provide: XpService,
          useValue: { summary: signal(null), streak: signal(null), loadSummary: () => {}, loadStreak: () => {} },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(DailySessionPage);
    fixture.detectChanges();

    primaryButton(fixture).click(); // Next on Read → fires markSeen('read', 'weak-hash-map')
    fixture.detectChanges();
    primaryButton(fixture).click(); // Next on Notice → fires markSeen('notice', 'weak-hash-map')
    fixture.detectChanges();

    expect(completeSpy).toHaveBeenCalledWith('read', 'weak-hash-map');
    expect(completeSpy).toHaveBeenCalledWith('notice', 'weak-hash-map');
    expect(completeSpy).toHaveBeenCalledTimes(2);
  });

  it('renders an honest empty state when there is nothing to review', () => {
    const fixture = setup(EMPTY_SESSION);

    expect(fixture.nativeElement.querySelector('.empty-session')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Nothing to review yet');
  });
});
