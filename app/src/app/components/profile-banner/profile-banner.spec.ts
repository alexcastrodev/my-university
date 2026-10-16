import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LevelProgress, ProfileBanner } from './profile-banner';

@Component({
  imports: [ProfileBanner],
  template: `
    <app-profile-banner
      avatarUrl="https://example.com/a.png" displayName="Ada" [handle]="handle" [visibility]="visibility"
      [level]="level" [levelProgress]="progress" [xp]="xp" [badgeCount]="3" [trophyCount]="1" [streak]="streak"
    >
      <button actions class="owner-only">Edit</button>
      <nav tabs class="the-tabs">tabs</nav>
    </app-profile-banner>
  `,
})
class Host {
  handle: string | null = 'ada-gh';
  visibility: 'public' | 'private' | null = 'public';
  level: { number: number; title: string } | null = { number: 3, title: 'Compiler Whisperer' };
  progress: LevelProgress | null = { percent: 40, remaining: 151 };
  xp: number | null = 329;
  streak: number | null = 5;
}

function setup(patch: Partial<Host> = {}) {
  TestBed.configureTestingModule({ imports: [Host], providers: [provideZonelessChangeDetection(), provideRouter([])] });
  const fixture = TestBed.createComponent(Host);
  Object.assign(fixture.componentInstance, patch);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { el, q: (sel: string) => el.querySelector(sel) as HTMLElement | null };
}

describe('ProfileBanner', () => {
  it('shows the name, handle, level and every number', () => {
    const { q } = setup();
    expect(q('.display-name')!.textContent).toBe('Ada');
    expect(q('.handle')!.textContent).toContain('ada-gh');
    expect(q('.level-line')!.textContent).toContain('Level 3');
    expect(q('.level-line')!.textContent).toContain('Compiler Whisperer');
    expect(q('[data-testid="badge-count"]')!.textContent).toBe('3');
    expect(q('[data-testid="trophy-count"]')!.textContent).toBe('1');
    expect(q('[data-testid="xp-total"]')!.textContent).toBe('329');
    expect(q('[data-testid="streak-days"]')!.textContent).toBe('5');
    expect(q('.avatar')!.getAttribute('src')).toBe('https://example.com/a.png');
  });

  it('shows the handle and the visibility chip only when given (a visitor gets neither)', () => {
    const { q } = setup({ handle: null, visibility: null });
    expect(q('.handle')).toBeNull();
    expect(q('[data-testid="visibility-chip"]')).toBeNull();
  });

  it('marks a public profile as not private', () => {
    expect(setup({ visibility: 'public' }).q('[data-testid="visibility-chip"]')!.classList.contains('visibility-private')).toBe(false);
  });

  it('marks a private profile differently', () => {
    const { q } = setup({ visibility: 'private' });
    expect(q('[data-testid="visibility-chip"]')!.classList.contains('visibility-private')).toBe(true);
    expect(q('[data-testid="visibility-chip"]')!.textContent!.trim()).toBe('Private');
  });

  it('draws the level bar with progress, and says how much is left', () => {
    const { q } = setup();
    expect(q('.level-fill')!.getAttribute('style')).toContain('40%');
    expect(q('.level-note')!.textContent).toContain('151 XP to next level');
  });

  it('says the top is reached when nothing is left', () => {
    expect(setup({ progress: { percent: 100, remaining: null } }).q('.level-note')!.textContent).toContain('Max level reached');
  });

  it('draws no level bar without progress', () => {
    expect(setup({ progress: null }).q('.level-bar')).toBeNull();
  });

  it('leaves out the level until it is known', () => {
    expect(setup({ level: null, progress: null }).q('.level')).toBeNull();
  });

  it('leaves out XP and streak until known', () => {
    const { q } = setup({ xp: null, streak: null });
    expect(q('[data-testid="xp-total"]')).toBeNull();
    expect(q('[data-testid="streak-days"]')).toBeNull();
  });

  it('shows a real zero for XP and streak', () => {
    const { q } = setup({ xp: 0, streak: 0 });
    expect(q('[data-testid="xp-total"]')!.textContent).toBe('0');
    expect(q('[data-testid="streak-days"]')!.textContent).toBe('0');
  });

  it('projects the owner\'s actions under the name and the tabs at the bottom edge of the band', () => {
    const { q } = setup();
    expect(q('.identity .actions .owner-only')).not.toBeNull();
    expect(q('.inner > .the-tabs')).not.toBeNull();
  });
});
