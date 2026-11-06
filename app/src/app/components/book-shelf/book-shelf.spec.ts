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

  it('says how long a book is, once it is opened', async () => {
    const { el, slots } = setup([{ ...books(1)[0], pages: 616 }, { ...books(1)[0], title: 'Short', pages: 1 }]);
    await until(() => slots().length === 2);
    slots()[0].click();
    expect(el.querySelector('.shelf-detail-meta')!.textContent).toBe('616 pages');
    slots()[1].click();
    expect(el.querySelector('.shelf-detail-meta')!.textContent).toBe('1 page');
  });

  it('shows the comment as text and a button to the link, in the language of the page', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { el, slots } = setup([{ ...books(1)[0], comment: `Worth reading.\n${hostile}` }]);
    await until(() => slots().length === 1);
    slots()[0].click();
    expect(Array.from(el.querySelectorAll('.shelf-detail-comment')).map((p) => p.textContent)).toEqual(['Worth reading.', hostile]);
    expect(el.querySelector('.shelf-detail img')).toBeNull();
    const link = el.querySelector<HTMLAnchorElement>('.shelf-detail-link')!;
    expect(link.textContent).toBe('Go to the book');
    expect(link.href).toBe('https://example.com/b');
    expect(link.rel).toBe('noopener noreferrer');
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
