import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SeoService } from '../../services/seo.service';
import { FaqPage } from './faq-page';

function setup() {
  const seoSet = jasmine.createSpy('set');
  TestBed.configureTestingModule({
    imports: [FaqPage],
    providers: [provideZonelessChangeDetection(), { provide: SeoService, useValue: { set: seoSet } }],
  });
  const fixture = TestBed.createComponent(FaqPage);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, seoSet };
}

describe('FaqPage', () => {
  it('has a #books section, the target of the link on an empty Library tab', () => {
    const { el } = setup();
    const section = el.querySelector('#books')!;
    expect(section.querySelector('h2')!.textContent).toContain('Show your books on your profile');
    expect(section.querySelectorAll('ol li').length).toBe(6);
  });

  it('shows the file to write, as lines with a comment, and the same books as a table', () => {
    const { el } = setup();
    const example = el.querySelector('[data-testid="books-example"]')!.textContent!;
    expect(example).toMatch(/^---\ntitle: .+\nurl: https:\/\/.+\npages: \d+\n/);
    expect(example).toContain('comment: ');
    const table = el.querySelector('[data-testid="books-example-table"]')!.textContent!;
    expect(table).toContain('| Book | Pages | Cover |');
    expect(table).toMatch(/\| \[[^\]]+\]\(https:\/\/[^)]+\) \| \d+ \| /);
    expect(el.textContent).toContain('public/books/your-login.md');
  });

  it('links to the repository folder and to creating a file there, in a new tab', () => {
    const { el } = setup();
    const folder = el.querySelector<HTMLAnchorElement>('[data-testid="books-folder"]')!;
    const create = el.querySelector<HTMLAnchorElement>('[data-testid="books-new-file"]')!;
    expect(folder.href).toBe('https://github.com/alexcastrodev/my-university/tree/main/public/books');
    expect(create.href).toBe('https://github.com/alexcastrodev/my-university/new/main/public/books');
    for (const link of [folder, create]) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
    }
  });

  it('warns that the file ties the books to the GitHub account', () => {
    expect(setup().el.querySelector('.note')!.textContent).toContain('carries your GitHub login');
  });

  it('is an indexable page of its own', () => {
    const { seoSet } = setup();
    expect(seoSet).toHaveBeenCalledWith(jasmine.objectContaining({ path: '/faq' }));
    expect(seoSet.calls.mostRecent().args[0].noindex).toBeUndefined();
  });
});
