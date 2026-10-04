import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { COMPLEMENTARY_AREAS } from '../computer-science/complementary-studies.data';
import { ComplementaryStudiesService } from '../computer-science/complementary-studies.service';
import { TracksPage } from './tracks-page';

class MockStudies {
  listProgress() {
    return of(COMPLEMENTARY_AREAS.map((a) => ({ slug: a.slug, read: 1, total: 4 })));
  }
}

describe('TracksPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TracksPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ComplementaryStudiesService, useClass: MockStudies },
      ],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(TracksPage);
    fixture.detectChanges();
    return fixture;
  }

  const cards = (f: ReturnType<typeof render>) =>
    Array.from<HTMLElement>(f.nativeElement.querySelectorAll('.card'));

  it('shows the exams card plus one card per complementary area', () => {
    expect(cards(render()).length).toBe(COMPLEMENTARY_AREAS.length + 1);
  });

  it('renders an svg icon on every card and no emoji', () => {
    for (const card of cards(render())) {
      expect(card.querySelector('.hex svg')).toBeTruthy();
      expect(card.querySelector('.hex')?.textContent?.trim()).toBe('');
    }
  });

  it('keeps a space between the concept count and its label', () => {
    const meta = cards(render())[1].querySelector('.meta')!;
    expect(meta.textContent).toMatch(/^\s*\d+\s+\S+/);
  });

  it('filters by the search text', () => {
    const fixture = render();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search');
    input.value = 'spring';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const found = cards(fixture);
    expect(found.length).toBe(1);
    expect(found[0].textContent).toContain('Spring');
  });

  it('filters by group and shows the empty state when nothing matches', () => {
    const fixture = render();
    const chips: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.chip'));
    chips[3].click(); // .NET and C#
    fixture.detectChanges();
    expect(cards(fixture).map((c) => c.textContent).join(' ')).toContain('C#');
    expect(cards(fixture).length).toBe(2);

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty')).toBeTruthy();
  });
});
