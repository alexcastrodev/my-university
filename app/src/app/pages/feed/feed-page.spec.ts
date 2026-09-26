import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { FeedArea, FeedItem, FeedPage as FeedPageData } from '../../models/feed.model';
import { AuthService } from '../../services/auth.service';
import { FeedService } from '../../services/feed.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { FeedPage } from './feed-page';

const ITEMS: FeedItem[] = [
  {
    module: 'jvm-concepts',
    slug: 'string-pool',
    title: 'String literals live in the string pool',
    summary: 'Equal literals point at the same object.',
    code: { lang: 'java', source: '"kurz" == "kurz" // true' },
    route: ['/java/jvm-concepts', 'string-pool'],
    read: false,
  },
  {
    module: 'foundations',
    discipline: 'programming-computational-thinking',
    slug: 'what-is-computation',
    title: 'What Is Computation',
    summary: 'The four pillars.',
    route: ['/computer-science', 'foundations', 'programming-computational-thinking', 'what-is-computation'],
    read: true,
  },
];

function page(items: FeedItem[], nextOffset: number | null = null, gotItToday = 2): FeedPageData {
  return { items, total: items.length, nextOffset, gotItToday };
}

function setup(options: { loggedIn?: boolean } = {}) {
  const { loggedIn = true } = options;
  const pageSpy = jasmine.createSpy('page').and.returnValue(of(page(ITEMS)));
  const gotItSpy = jasmine.createSpy('gotIt').and.returnValue(of({ read: true, gotItToday: 3 }));
  const loadSummary = jasmine.createSpy('loadSummary');

  TestBed.configureTestingModule({
    imports: [FeedPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: { currentUser: signal(loggedIn ? { id: 1, displayName: 'Ana' } : null) } },
      { provide: FeedService, useValue: { page: pageSpy, gotIt: gotItSpy } },
      { provide: SeoService, useValue: { set: () => {} } },
      { provide: XpService, useValue: { loadSummary } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(FeedPage);
  fixture.detectChanges();
  return { fixture, pageSpy, gotItSpy, loadSummary };
}

describe('FeedPage', () => {
  it('loads the first page of every area and renders one card per item', () => {
    const { fixture, pageSpy } = setup();

    expect(pageSpy).toHaveBeenCalledWith('all', 0);
    const cards = fixture.nativeElement.querySelectorAll('.card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.crumb').textContent).toContain('Java › JVM');
    expect(cards[0].querySelector('.code').textContent).toContain('"kurz" == "kurz"');
    expect(cards[1].querySelector('.crumb').textContent).toContain('Computer Science › Programming & Computational Thinking');
    expect(cards[1].querySelector('.code')).toBeNull();
  });

  it('shows how many concepts were marked today', () => {
    const { fixture } = setup();

    expect(fixture.nativeElement.querySelector('.feed-count').textContent).toContain('2 Got it today');
  });

  it('marks a card as Got it and refreshes the XP', () => {
    const { fixture, gotItSpy, loadSummary } = setup();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.card .got-it');
    button.click();
    fixture.detectChanges();

    expect(gotItSpy).toHaveBeenCalledWith(ITEMS[0]);
    expect(fixture.nativeElement.querySelector('.card .got-it').classList).toContain('done');
    expect(fixture.nativeElement.querySelector('.feed-count').textContent).toContain('3 Got it today');
    expect(loadSummary).toHaveBeenCalled();
  });

  it('does not offer Got it again on a card already marked', () => {
    const { fixture } = setup();

    const second: HTMLButtonElement = fixture.nativeElement.querySelectorAll('.card .got-it')[1];
    expect(second.disabled).toBeTrue();
  });

  it('restarts from the top of the chosen area on a chip tap', () => {
    const { fixture, pageSpy } = setup();

    const javaChip = Array.from(fixture.nativeElement.querySelectorAll('.chip') as NodeListOf<HTMLButtonElement>).find(
      (chip) => chip.textContent?.trim() === 'Java',
    )!;
    javaChip.click();
    fixture.detectChanges();

    expect(pageSpy).toHaveBeenCalledWith('java' as FeedArea, 0);
    expect(javaChip.classList).toContain('active');
  });

  it('drops a late response that belongs to the previous area', () => {
    const { fixture, pageSpy } = setup();
    const slowJava = new Subject<FeedPageData>();

    pageSpy.and.returnValue(slowJava);
    fixture.componentInstance.selectArea('java');
    pageSpy.and.returnValue(of(page([ITEMS[1]])));
    fixture.componentInstance.selectArea('cs');
    slowJava.next(page([ITEMS[0]]));
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('What Is Computation');
  });

  it('asks guests to log in instead of offering Got it', () => {
    const { fixture } = setup({ loggedIn: false });

    expect(fixture.nativeElement.querySelector('button.got-it')).toBeNull();
    expect(fixture.nativeElement.querySelector('a.got-it').getAttribute('href')).toBe('/login');
    expect(fixture.nativeElement.querySelector('.feed-count')).toBeNull();
  });
});
