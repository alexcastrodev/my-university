import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PublicBook } from '../../models/public-profile.model';
import { BookShelf } from './book-shelf';

const books = (n: number): PublicBook[] =>
  Array.from({ length: n }, (_, i) => ({ title: `Book ${i}`, url: 'https://example.com/b', pages: 200 + i * 40 }));

/** The package loads on demand, so the shelf shows up a moment after the first render. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

function setup(list: PublicBook[]) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(BookShelf);
  fixture.componentRef.setInput('books', list);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, slots: () => el.querySelectorAll<HTMLButtonElement>('.sb-slot') };
}

describe('BookShelf', () => {
  it('draws one button per book, named in the language of the page', async () => {
    const { el, slots } = setup(books(3));
    await until(() => slots().length === 3);
    expect(Array.from(slots()).map((s) => s.getAttribute('aria-label'))).toEqual(['Open Book 0', 'Open Book 1', 'Open Book 2']);
    expect(el.classList).toContain('book-shelf');
  });

  it('starts with the first book open and says so through `opened`', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(BookShelf);
    const opened: string[] = [];
    fixture.componentInstance.opened.subscribe((book) => opened.push(book.title));
    fixture.componentRef.setInput('books', books(3));
    fixture.detectChanges();
    const slots = () => (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.sb-slot');
    await until(() => slots().length === 3);
    expect(Array.from(slots()).map((s) => s.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    slots()[2].click();
    expect(opened.at(0)).toBe('Book 0');
    expect(opened.at(-1)).toBe('Book 2');
  });

  it('leaves the details to the card beside it', async () => {
    const { el, slots } = setup(books(2));
    await until(() => slots().length === 2);
    expect(el.querySelector('.shelf-detail-title')).toBeNull();
  });

  it('shows the new books when the list changes', async () => {
    const { fixture, slots } = setup(books(2));
    await until(() => slots().length === 2);
    fixture.componentRef.setInput('books', books(4));
    fixture.detectChanges();
    await until(() => slots().length === 4);
    expect(slots().length).toBe(4);
  });

  it('cleans up after itself when the component goes away', async () => {
    const { fixture, el, slots } = setup(books(2));
    await until(() => slots().length === 2);
    fixture.destroy();
    expect(el.childNodes.length).toBe(0);
  });

  it('draws nothing, and does not fail, when destroyed before the package arrives', () => {
    const { fixture, el } = setup(books(2));
    expect(() => fixture.destroy()).not.toThrow();
    expect(el.querySelectorAll('.sb-slot').length).toBe(0);
  });
});
