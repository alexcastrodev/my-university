import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SeoService } from '../../services/seo.service';
import { DailySourcesPage } from './daily-sources-page';

function setup() {
  TestBed.configureTestingModule({
    imports: [DailySourcesPage],
    providers: [
      provideZonelessChangeDetection(),
      { provide: SeoService, useValue: { set: () => {} } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DailySourcesPage);
  fixture.detectChanges();
  return fixture;
}

describe('DailySourcesPage', () => {
  it('renders the title and both source groups', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.src-title').textContent).toContain(
      'Both tracks feed the session',
    );
    const groups = fixture.nativeElement.querySelectorAll('.src-card');
    expect(groups.length).toBe(2);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Computer Science');
    expect(text).toContain('Complementary studies');
  });

  it('renders the chips for each track', () => {
    const fixture = setup();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('S2 Algorithms');
    expect(text).toContain('Java Concepts');
  });

  it('tints only the complementary track chips as accent', () => {
    const fixture = setup();

    const accentChips = fixture.nativeElement.querySelectorAll('.chip.accent');
    expect(accentChips.length).toBe(4);
    expect(accentChips[0].textContent).toContain('Java Concepts');
  });

  it('lists the four selection rules', () => {
    const fixture = setup();

    const rules = fixture.nativeElement.querySelectorAll('.rules li');
    expect(rules.length).toBe(4);
    expect(rules[0].textContent).toContain('Expiring marks come first');
  });
});
