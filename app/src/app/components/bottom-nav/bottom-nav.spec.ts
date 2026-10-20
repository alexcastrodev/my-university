import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BottomNav } from './bottom-nav';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models/auth.model';

@Component({ template: '' })
class Dummy {}

describe('BottomNav', () => {
  async function setup(url: string, user: User | null = { id: 1, displayName: 'Ada' } as User) {
    const currentUser = signal<User | null>(user);
    TestBed.configureTestingModule({
      imports: [BottomNav],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { currentUser } },
        provideRouter([{ path: '**', component: Dummy }]),
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(BottomNav);
    fixture.detectChanges();
    return { fixture, router, currentUser };
  }

  function homeTab(fixture: { nativeElement: HTMLElement }): HTMLAnchorElement | undefined {
    return Array.from<HTMLAnchorElement>(fixture.nativeElement.querySelectorAll('a.tab')).find((a) =>
      a.textContent?.includes('Home'),
    );
  }

  it('links Home to the dashboard when logged in', async () => {
    const { fixture } = await setup('/computer-science');

    expect(homeTab(fixture)?.getAttribute('href')).toBe('/dashboard');
  });

  it('links Home to the landing page when logged out', async () => {
    const { fixture } = await setup('/computer-science', null);

    expect(homeTab(fixture)?.getAttribute('href')).toBe('/');
  });

  it('switches Home to the landing page right after logout', async () => {
    const { fixture, currentUser } = await setup('/settings');
    expect(homeTab(fixture)?.getAttribute('href')).toBe('/dashboard');

    currentUser.set(null);
    fixture.detectChanges();

    expect(homeTab(fixture)?.getAttribute('href')).toBe('/');
  });

  it('renders the four tabs', async () => {
    const { fixture } = await setup('/dashboard');

    const tabs = fixture.nativeElement.querySelectorAll('.tab');
    expect(tabs.length).toBe(4);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Home');
    expect(text).not.toContain('Daily');
    expect(text).toContain('Track');
    expect(text).toContain('Discussions');
    expect(text).toContain('Settings');
  });

  it('links Discussions to the discussions feed', async () => {
    const { fixture } = await setup('/dashboard');

    const tab = Array.from<HTMLAnchorElement>(fixture.nativeElement.querySelectorAll('a.tab')).find((a) =>
      a.textContent?.includes('Discussions'),
    );

    expect(tab?.getAttribute('href')).toBe('/discussions');
  });

  it('links Settings to the settings page, which replaces the header on phones', async () => {
    const { fixture } = await setup('/dashboard');

    const settingsTab = Array.from<HTMLAnchorElement>(
      fixture.nativeElement.querySelectorAll('a.tab'),
    ).find((a) => a.textContent?.includes('Settings'));

    expect(settingsTab?.getAttribute('href')).toBe('/settings');
  });
});
