import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PublicBook } from '../../models/public-profile.model';
import { BookSummary } from './book-summary';

function render(book: PublicBook): HTMLElement {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(BookSummary);
  fixture.componentRef.setInput('book', book);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('BookSummary', () => {
  it('shows the title, a link to the book that opens in a new tab, and the total of pages', () => {
    const el = render({ title: 'Clean Code', url: 'https://example.com/cc', pages: 464 });
    expect(el.querySelector('.title')!.textContent).toBe('Clean Code');
    const link = el.querySelector<HTMLAnchorElement>('[data-testid=book-summary-link]')!;
    expect(link.href).toBe('https://example.com/cc');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent!.trim()).toBe('Go to the book');
    expect(el.querySelector('[data-testid=book-summary-pages]')!.textContent).toBe('464');
    expect(el.querySelector('.comment')).toBeNull();
  });

  it('labels the facts like the top of a paper', () => {
    const el = render({ title: 'T', url: 'https://example.com/t', pages: 10 });
    expect(Array.from(el.querySelectorAll('.fact dt')).map((dt) => dt.textContent)).toEqual(['Link', 'Pages']);
  });

  it('shows each comment line as a paragraph of text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const el = render({ title: 'T', url: 'https://example.com/t', pages: 10, comment: `Worth reading.\n${hostile}` });
    expect(Array.from(el.querySelectorAll('.comment')).map((p) => p.textContent)).toEqual(['Worth reading.', hostile]);
    expect(el.querySelector('.summary img')).toBeNull();
  });
});
