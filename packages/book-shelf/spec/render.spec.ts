import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountBookShelf, safeHttpsUrl } from '../src/render';
import type { ShelfBook, ShelfLabels } from '../src/types';

const labels: ShelfLabels = {
  pages: (count) => `${count} pages`,
  open: (title) => `Open ${title}`,
};

const sample = (n: number): ShelfBook[] =>
  Array.from({ length: n }, (_, i) => ({ title: `Book ${i}`, pages: 300 + i }));

let host: HTMLElement;
beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host')!;
});
afterEach(() => {
  document.body.innerHTML = '';
});

const slots = () => [...host.querySelectorAll<HTMLButtonElement>('.sb-slot')];
const rows = () => host.querySelectorAll('.shelf-row');

describe('safeHttpsUrl', () => {
  it('keeps https and drops everything else', () => {
    expect(safeHttpsUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', '//example.com', 'not a url', '', undefined]) {
      expect(safeHttpsUrl(bad)).toBeUndefined();
    }
  });
});

describe('mountBookShelf', () => {
  it('draws one button per book, named for it', () => {
    mountBookShelf(host, sample(3), { labels });
    expect(slots().map((s) => s.getAttribute('aria-label'))).toEqual(['Open Book 0', 'Open Book 1', 'Open Book 2']);
    expect(slots().every((s) => s.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('gives each row its own board, and wraps instead of scrolling', () => {
    const handle = mountBookShelf(host, sample(12), { labels });
    // 28px slots, 3px gaps, and 132px kept in each row so a book can open (160 less the slot); 8px at each end
    // under 480px.
    handle.relayout(400);
    expect(rows().length).toBe(2);
    expect(host.querySelectorAll('.shelf-board').length).toBe(2);
    handle.relayout(300);
    expect(rows().length).toBe(3);
    handle.relayout(1600);
    expect(rows().length).toBe(1);
  });

  it('opens a smaller cover on a phone, so more books fit in a row, and the full one on a wide shelf', () => {
    const handle = mountBookShelf(host, sample(12), { labels });
    const first = () => ({ width: slots()[0].style.width, cover: slots()[0].style.getPropertyValue('--w') });
    handle.relayout(390);
    slots()[0].click();
    expect(first()).toEqual({ width: '160px', cover: '128px' });
    handle.relayout(1200); // the open book stays open when the rows are laid out again
    expect(first()).toEqual({ width: '206px', cover: '150px' });
  });

  it('keeps every book, in order, when the rows change', () => {
    const handle = mountBookShelf(host, sample(12), { labels });
    handle.relayout(400);
    expect(slots().map((s) => s.getAttribute('aria-label'))).toEqual(sample(12).map((b) => `Open ${b.title}`));
  });

  it('makes a longer book a wider spine', () => {
    mountBookShelf(host, [{ title: 'Short', pages: 120 }, { title: 'Long', pages: 700 }], { labels });
    const [short, long] = slots();
    expect(parseInt(long.style.width)).toBeGreaterThan(parseInt(short.style.width));
  });

  it('writes titles as text, never as markup', () => {
    mountBookShelf(host, [{ title: '<img src=x onerror=alert(1)>', pages: 200 }], { labels });
    expect(host.querySelectorAll('img').length).toBe(0);
    expect(host.querySelector('.sb-spine-title')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('uses an https cover and ignores any other', () => {
    mountBookShelf(host, [
      { title: 'A', pages: 100, cover: 'https://example.com/a.jpg' },
      { title: 'B', pages: 100, cover: 'javascript:alert(1)' },
      { title: 'C', pages: 100, cover: 'http://example.com/c.jpg' },
    ], { labels });
    const images = host.querySelectorAll('img');
    expect(images.length).toBe(1);
    expect(images[0].getAttribute('src')).toBe('https://example.com/a.jpg');
    expect(images[0].getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('falls back to the plain cover when the image does not load', () => {
    mountBookShelf(host, [{ title: 'A', pages: 100, cover: 'https://example.com/a.jpg' }], { labels });
    const front = host.querySelector('.sb-front')!;
    expect(front.classList.contains('has-cover')).toBe(true);
    host.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(host.querySelector('img')).toBeNull();
    expect(front.classList.contains('has-cover')).toBe(false);
  });

  it('opens a book on click, shows its pages and link, and closes it on a second click', () => {
    mountBookShelf(host, [{ title: 'Clean Code', pages: 464, url: 'https://example.com/cc' }], { labels });
    const [slot] = slots();
    slot.click();
    expect(slot.getAttribute('aria-pressed')).toBe('true');
    expect(slot.classList.contains('is-open')).toBe(true);
    expect(slot.style.width).toBe('206px');
    const link = host.querySelector<HTMLAnchorElement>('.shelf-detail a')!;
    expect(link.href).toBe('https://example.com/cc');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(host.querySelector('.shelf-detail-meta')!.textContent).toBe('464 pages');
    slot.click();
    expect(slot.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('.shelf-detail')!.childNodes.length).toBe(0);
  });

  it('does not make a link out of an address that is not https', () => {
    mountBookShelf(host, [{ title: 'X', pages: 100, url: 'javascript:alert(1)' }], { labels });
    slots()[0].click();
    expect(host.querySelector('.shelf-detail a')).toBeNull();
    expect(host.querySelector('.shelf-detail-title')!.textContent).toBe('X');
  });

  it('keeps one book open at a time', () => {
    mountBookShelf(host, sample(3), { labels });
    slots()[0].click();
    slots()[2].click();
    expect(slots().map((s) => s.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('closes the open book on Escape and puts the focus back on it', () => {
    mountBookShelf(host, sample(2), { labels });
    slots()[1].click();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(slots()[1].getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(slots()[1]);
  });

  it('keeps the open book open when the rows are laid out again', () => {
    const handle = mountBookShelf(host, sample(12), { labels });
    slots()[7].click();
    handle.relayout(400);
    expect(slots()[7].getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('.shelf-detail:not(:empty)').length).toBe(1);
  });

  it('shows the new books and closes the open one on update', () => {
    const handle = mountBookShelf(host, sample(3), { labels });
    slots()[0].click();
    handle.update(sample(5));
    expect(slots().length).toBe(5);
    expect(slots().every((s) => s.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('shows nothing for no books', () => {
    mountBookShelf(host, [], { labels });
    expect(slots().length).toBe(0);
  });

  it('adds its stylesheet once, however many shelves there are', () => {
    mountBookShelf(host, sample(1), { labels });
    const other = document.createElement('div');
    document.body.append(other);
    mountBookShelf(other, sample(1), { labels });
    expect(document.head.querySelectorAll('style[data-book-shelf]').length).toBe(1);
  });

  it('empties the container and stops listening on destroy', () => {
    const handle = mountBookShelf(host, sample(2), { labels });
    handle.destroy();
    expect(host.childNodes.length).toBe(0);
    expect(host.classList.contains('book-shelf')).toBe(false);
  });
});
