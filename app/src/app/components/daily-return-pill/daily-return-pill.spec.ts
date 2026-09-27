import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { DailyProgress, DailyProgressService } from '../../services/daily-progress.service';
import { DailyReturnPill } from './daily-return-pill';

@Component({ template: '' })
class Blank {}

const PROGRESS: DailyProgress = {
  session: { estimatedMinutes: 1, summary: { headline: '', tomorrow: { title: '', body: '' } }, cards: [] },
  index: 0,
  earned: 0,
  earnedCards: [],
  completedKeys: [],
  recallAnswered: null,
  revealed: false,
  writeText: '',
  writeSaved: false,
};

async function setup(url: string) {
  TestBed.configureTestingModule({
    imports: [DailyReturnPill],
    providers: [provideZonelessChangeDetection(), provideRouter([{ path: '**', component: Blank }])],
  });
  const fixture = TestBed.createComponent(DailyReturnPill);
  await TestBed.inject(Router).navigateByUrl(url);
  fixture.detectChanges();
  return fixture;
}

describe('DailyReturnPill', () => {
  it('stays hidden when no session is parked', async () => {
    const fixture = await setup('/java/java-concepts/set-interface');
    expect(fixture.nativeElement.querySelector('.daily-return-pill')).toBeNull();
  });

  it('offers the way back on the topic opened from the session', async () => {
    const fixture = await setup('/java/java-concepts/set-interface#details');
    TestBed.inject(DailyProgressService).park(PROGRESS, '/java/java-concepts/set-interface');
    fixture.detectChanges();

    const pill = fixture.nativeElement.querySelector('.daily-return-pill') as HTMLAnchorElement;
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('href')).toBe('/daily/session');
  });

  it('hides once the user wanders to another page', async () => {
    const fixture = await setup('/java/java-concepts/set-interface');
    TestBed.inject(DailyProgressService).park(PROGRESS, '/java/java-concepts/set-interface');
    await TestBed.inject(Router).navigateByUrl('/java/java-concepts/list-interface');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.daily-return-pill')).toBeNull();
  });
});
