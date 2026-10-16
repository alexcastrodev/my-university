import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProfileHeader } from './profile-header';

@Component({
  imports: [ProfileHeader],
  template: `
    <app-profile-header avatarUrl="https://example.com/a.png" displayName="Ada" [level]="level" [xp]="xp" [badgeCount]="3" [trophyCount]="1">
      <button class="owner-only">Edit</button>
    </app-profile-header>
  `,
})
class Host {
  level: { number: number; title: string } | null = { number: 3, title: 'Compiler Whisperer' };
  xp: number | null = 329;
}

function setup(patch: Partial<Host> = {}) {
  TestBed.configureTestingModule({ imports: [Host], providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(Host);
  Object.assign(fixture.componentInstance, patch);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ProfileHeader', () => {
  it('shows the name, level, XP and both counters', () => {
    const el = setup();
    expect(el.querySelector('.display-name')!.textContent).toBe('Ada');
    expect(el.querySelector('.level')!.textContent).toContain('Level 3');
    expect(el.querySelector('.level')!.textContent).toContain('Compiler Whisperer');
    expect(el.querySelector('.xp')!.textContent).toContain('329 XP');
    expect(el.querySelector('[data-testid="badge-count"]')!.textContent).toBe('3');
    expect(el.querySelector('[data-testid="trophy-count"]')!.textContent).toBe('1');
    expect(el.querySelector('.avatar')!.getAttribute('src')).toBe('https://example.com/a.png');
  });

  it('leaves out the level and the XP until they are known, instead of showing zeros', () => {
    const el = setup({ level: null, xp: null });
    expect(el.querySelector('.level')).toBeNull();
    expect(el.querySelector('.xp')).toBeNull();
  });

  it('shows 0 XP when it really is zero', () => {
    expect(setup({ xp: 0 }).querySelector('.xp')!.textContent).toContain('0 XP');
  });

  it('projects what the page puts inside, under the name (the owner\'s controls)', () => {
    const el = setup();
    expect(el.querySelector('.identity .owner-only')).not.toBeNull();
  });
});
