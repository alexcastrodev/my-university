import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BottomNav } from './bottom-nav';

@Component({ template: '' })
class Dummy {}

describe('BottomNav', () => {
  async function setup(url: string) {
    TestBed.configureTestingModule({
      imports: [BottomNav],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: 'daily/session', component: Dummy },
          { path: '**', component: Dummy },
        ]),
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(BottomNav);
    fixture.detectChanges();
    return { fixture, router };
  }

  it('renders the four tabs', async () => {
    const { fixture } = await setup('/dashboard');

    const tabs = fixture.nativeElement.querySelectorAll('.tab');
    expect(tabs.length).toBe(4);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Home');
    expect(text).toContain('Daily');
    expect(text).toContain('Track');
    expect(text).toContain('Map');
  });

  it('links Map to the curriculum graph page', async () => {
    const { fixture } = await setup('/dashboard');

    const mapTab: HTMLAnchorElement | null = Array.from(
      fixture.nativeElement.querySelectorAll('a.tab'),
    ).find((a) => (a as HTMLAnchorElement).textContent?.includes('Map')) as HTMLAnchorElement | null;

    expect(mapTab).toBeTruthy();
    expect(mapTab!.getAttribute('href')).toBe('/map');
  });

  it('is visible on regular routes', async () => {
    const { fixture } = await setup('/daily');

    expect(fixture.nativeElement.querySelector('.bottom-nav')).toBeTruthy();
  });

  it('hides itself on the full-screen session runner', async () => {
    const { fixture, router } = await setup('/daily');
    expect(fixture.nativeElement.querySelector('.bottom-nav')).toBeTruthy();

    await router.navigateByUrl('/daily/session');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.bottom-nav')).toBeNull();
  });
});
