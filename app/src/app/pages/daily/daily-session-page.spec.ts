import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DailySession } from '../../models/daily.model';
import { AuthService } from '../../services/auth.service';
import { DailySessionService } from '../../services/daily-session.service';
import { DailyProgressService } from '../../services/daily-progress.service';
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
      module: 'java-concepts',
      answer: 'Once only `WeakReference`s point at it.',
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
  return fixture.nativeElement.querySelector('.actions .primary-btn') as HTMLButtonElement;
}

function click(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string): void {
  (fixture.nativeElement.querySelector(selector) as HTMLElement).click();
  fixture.detectChanges();
}

describe('DailySessionPage', () => {
  it('opens on the first card with a segmented progress bar and nothing earned yet', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelectorAll('.seg').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.seg.filled').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.earned').textContent).toContain('+0 XP');
    expect(fixture.nativeElement.querySelector('.crumb').textContent).toContain('Java › Concepts');
  });

  it('keeps the Recall answer hidden until the flashcard is flipped', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.flashcard').textContent).not.toContain('WeakReference');
    expect(fixture.nativeElement.querySelector('.rate-remembered')).toBeNull();

    click(fixture, '.flashcard');

    const answer = fixture.nativeElement.querySelector('.flashcard-answer');
    expect(answer.textContent).toContain('Once only WeakReferences point at it.');
    expect(answer.querySelector('code')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.rate-remembered')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.rate-forgot')).toBeTruthy();
  });

  it('flips the card from the bottom button too', () => {
    const fixture = setup();

    primaryButton(fixture).click(); // Show answer
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.flashcard.revealed')).toBeTruthy();
  });

  it('credits the card XP once it is rated, then offers Next', () => {
    const fixture = setup();

    click(fixture, '.flashcard');
    click(fixture, '.rate-remembered');

    expect(fixture.nativeElement.querySelector('.feedback.good')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.earned').textContent).toContain('+20 XP');
    expect(primaryButton(fixture).textContent).toContain('Next');
  });

  it('reassures instead of punishing on "I did not remember"', () => {
    const fixture = setup();

    click(fixture, '.flashcard');
    click(fixture, '.rate-forgot');

    expect(fixture.nativeElement.querySelector('.feedback').textContent).toContain('No worries');
    expect(fixture.nativeElement.querySelector('.topic-link[href]')).toBeTruthy();
  });

  it('advances to the write card and then to the done screen', () => {
    const fixture = setup();

    click(fixture, '.flashcard');
    click(fixture, '.rate-remembered');
    primaryButton(fixture).click(); // Next → card 2
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.seg.filled').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.write-input')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.flashcard')).toBeNull();

    primaryButton(fixture).click(); // Save and finish → done
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.done')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.done-headline').textContent).toContain('You renewed a mark');
    expect(fixture.nativeElement.querySelectorAll('.recap-row').length).toBe(2);
  });

  it('restarts from the done screen with Keep going', () => {
    const fixture = setup();

    click(fixture, '.flashcard');
    click(fixture, '.rate-remembered');
    primaryButton(fixture).click(); // Next → card 2
    fixture.detectChanges();
    primaryButton(fixture).click(); // Save and finish → done
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.done')).toBeTruthy();

    click(fixture, '.done-ghost');

    expect(fixture.nativeElement.querySelectorAll('.seg.filled').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.earned').textContent).toContain('+0 XP');
    expect(fixture.nativeElement.querySelector('.flashcard.revealed')).toBeNull();
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

    click(fixture, '.flashcard');
    click(fixture, '.rate-remembered');

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

  it('comes back to the same card, rated and credited, after opening the full topic', () => {
    const fixture = setup();
    click(fixture, '.flashcard');
    click(fixture, '.rate-remembered');

    fixture.componentInstance.openTopic(['/java/java-concepts', 'reference-reachability']);
    const progress = TestBed.inject(DailyProgressService);
    expect(progress.topicUrl()).toBe('/java/java-concepts/reference-reachability');
    fixture.destroy();

    const buildSpy = spyOn(TestBed.inject(DailySessionService), 'build').and.callThrough();
    const back = TestBed.createComponent(DailySessionPage);
    back.detectChanges();

    expect(buildSpy).not.toHaveBeenCalled();
    expect(back.nativeElement.querySelector('.earned').textContent).toContain('+20 XP');
    expect(back.nativeElement.querySelector('.flashcard.revealed')).toBeTruthy();
    expect(back.nativeElement.querySelector('.feedback.good')).toBeTruthy();
    expect(progress.topicUrl()).toBeNull();
  });

  it('forgets a parked run when the session is closed', () => {
    const fixture = setup();
    fixture.componentInstance.openTopic(['/java/java-concepts', 'reference-reachability']);
    click(fixture, '.close-btn');

    expect(TestBed.inject(DailyProgressService).topicUrl()).toBeNull();
  });

  it('renders an honest empty state when there is nothing to review', () => {
    const fixture = setup(EMPTY_SESSION);

    expect(fixture.nativeElement.querySelector('.empty-session')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Nothing to review yet');
  });
});
