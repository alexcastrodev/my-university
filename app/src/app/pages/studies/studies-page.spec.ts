import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StudiesPage } from './studies-page';

describe('StudiesPage', () => {
  it('shows one card each for Tracks, Certifications, Papers and Computer Science', async () => {
    await TestBed.configureTestingModule({
      imports: [StudiesPage],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(StudiesPage);
    fixture.detectChanges();

    const cards = Array.from<HTMLAnchorElement>(fixture.nativeElement.querySelectorAll('a.card'));
    expect(cards.map((c) => c.getAttribute('href'))).toEqual(['/tracks', '/exams', '/papers', '/computer-science']);
    expect(cards.map((c) => c.querySelector('.name')?.textContent?.trim())).toEqual([
      'Tracks',
      'Certifications',
      'Papers',
      'Computer Science',
    ]);
  });
});
