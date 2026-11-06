import { COVER_WIDTH, DEFAULTS, LayoutOptions, hashString, packRows, slotWidth, spineHeight, spineWidth } from './layout';
import { CSS } from './styles';
import type { ShelfBook, ShelfLabels } from './types';

export interface MountOptions {
  labels: ShelfLabels;
  layout?: LayoutOptions;
}

export interface ShelfHandle {
  /** Replaces the books and closes the open one. */
  update(books: ShelfBook[]): void;
  /** Lays the rows out again, for `width` px or, left out, for the container's current width. */
  relayout(width?: number): void;
  destroy(): void;
}

/** Used when the container has no width yet (hidden, or not laid out): the real width arrives with the resize. */
const FALLBACK_WIDTH = 960;
/**
 * Under this width the rows lose most of their side space and the cover opens smaller (a narrower cover,
 * and less room reserved for it), so a phone row holds 4 or 5 books instead of 3.
 */
const NARROW = 480;
const NARROW_COVER = 128;
const NARROW_OPEN = 160;

let instances = 0;

/** The URL again if it is `https:`, else nothing. Covers and links from a file anyone can edit must pass this. */
export function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function injectStyles(doc: Document): void {
  if (doc.head.querySelector('style[data-book-shelf]')) return;
  const style = doc.createElement('style');
  style.setAttribute('data-book-shelf', '');
  style.textContent = CSS;
  doc.head.append(style);
}

/**
 * Draws `books` into `host` as shelves: each row has its own board, rows wrap when the next book does not
 * fit, and the shelf never scrolls sideways. Click (or Enter) opens a book, Escape closes it. All text goes
 * in through `textContent`.
 */
export function mountBookShelf(host: HTMLElement, initial: ShelfBook[], options: MountOptions): ShelfHandle {
  const doc = host.ownerDocument;
  const { labels } = options;
  const instance = ++instances;
  const layout = { ...DEFAULTS, ...options.layout };
  injectStyles(doc);
  host.classList.add('book-shelf');

  let books = initial;
  let width = 0;
  // Set by build() from the width: the full size on a wide shelf, the smaller one on a phone.
  let coverWidth = COVER_WIDTH;
  let openWidth = layout.openWidth;
  let open: number | null = null;
  let slots: HTMLButtonElement[] = [];
  let details: HTMLElement[] = [];
  let rowOf: number[] = [];

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  };

  function makeSlot(book: ShelfBook, index: number): HTMLButtonElement {
    const hash = hashString(book.title);
    const color = `hsl(${hash % 360} 38% ${24 + ((hash >>> 9) % 14)}%)`;
    const slot = el('button', 'sb-slot');
    slot.type = 'button';
    slot.setAttribute('aria-pressed', 'false');
    slot.setAttribute('aria-label', labels.open(book.title));
    slot.style.setProperty('--w', `${coverWidth}px`);
    slot.style.setProperty('--h', `${spineHeight(book.title)}px`);
    slot.style.setProperty('--d', `${spineWidth(book.pages, layout)}px`);
    slot.style.width = `${slotWidth(book.pages, layout)}px`;
    slot.style.height = `${spineHeight(book.title)}px`;

    const box = el('span', 'sb-book');
    const front = el('span', 'sb-front');
    front.style.background = color;
    front.style.color = '#fff';
    const frontTitle = el('span', 'sb-front-title');
    frontTitle.textContent = book.title;
    front.append(frontTitle);
    const cover = safeHttpsUrl(book.cover);
    if (cover) {
      const img = el('img', 'sb-cover');
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.src = cover;
      // A cover that does not load leaves the title on a plain cover instead of a broken image.
      img.addEventListener('error', () => {
        img.remove();
        front.classList.remove('has-cover');
      });
      front.classList.add('has-cover');
      front.prepend(img);
    }

    const spine = el('span', 'sb-spine');
    spine.style.background = color;
    spine.style.color = '#fff';
    const spineTitle = el('span', 'sb-spine-title');
    spineTitle.textContent = book.title;
    spine.append(el('span', 'sb-band'), spineTitle, el('span', 'sb-spine-dot'));

    box.append(front, spine, el('span', 'sb-pages'), el('span', 'sb-top'));
    slot.append(box);
    slot.addEventListener('click', () => {
      open = open === index ? null : index;
      paint();
    });
    return slot;
  }

  /** Title and length on one line, the comment as paragraphs, then the button to the book's page. Text only, never markup. */
  function detailNodes(book: ShelfBook): Node[] {
    const head = el('div', 'shelf-detail-head');
    const title = el('h3', 'shelf-detail-title');
    title.id = `book-shelf-title-${instance}`;
    title.textContent = book.title;
    const meta = el('p', 'shelf-detail-meta');
    meta.textContent = labels.pages(book.pages);
    head.append(title, meta);
    const nodes: Node[] = [head];
    if (typeof book.comment === 'string') {
      for (const paragraph of book.comment.split('\n')) {
        if (!paragraph.trim()) continue;
        const p = el('p', 'shelf-detail-comment');
        p.textContent = paragraph;
        nodes.push(p);
      }
    }
    const url = safeHttpsUrl(book.url);
    if (url) {
      const link = el('a', 'shelf-detail-link');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      // The button says what it does and the heading above says for which book.
      link.setAttribute('aria-describedby', title.id);
      link.textContent = labels.visit;
      nodes.push(link);
    }
    return nodes;
  }

  /** Applies the open book to the slots and the detail block, without rebuilding anything (so widths animate). */
  function paint(): void {
    slots.forEach((slot, i) => {
      const isOpen = i === open;
      slot.classList.toggle('is-open', isOpen);
      slot.setAttribute('aria-pressed', String(isOpen));
      slot.style.width = `${isOpen ? openWidth : slotWidth(books[i].pages, layout)}px`;
    });
    details.forEach((detail, row) => {
      detail.replaceChildren();
      if (open !== null && rowOf[open] === row) detail.append(...detailNodes(books[open]));
    });
  }

  function build(forWidth: number): void {
    width = forWidth;
    const narrow = width < NARROW;
    const padding = narrow ? 8 : layout.padding;
    coverWidth = narrow ? NARROW_COVER : COVER_WIDTH;
    openWidth = narrow ? Math.min(layout.openWidth, NARROW_OPEN) : layout.openWidth;
    const rows = packRows(books.map((book, index) => ({ index, pages: book.pages })), width, { ...layout, padding, openWidth });
    host.replaceChildren();
    slots = [];
    details = [];
    rowOf = [];
    rows.forEach((row, r) => {
      const shelf = el('div', 'shelf');
      const rowEl = el('div', 'shelf-row');
      rowEl.style.padding = `24px ${padding}px 0`;
      for (const { index } of row) {
        slots[index] = makeSlot(books[index], index);
        rowOf[index] = r;
        rowEl.append(slots[index]);
      }
      const detail = el('div', 'shelf-detail');
      details[r] = detail;
      shelf.append(rowEl, el('div', 'shelf-board'), detail);
      host.append(shelf);
    });
    if (open !== null && open >= books.length) open = null;
    paint();
  }

  const measure = () => host.clientWidth || FALLBACK_WIDTH;

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || open === null) return;
    const closing = open;
    open = null;
    paint();
    slots[closing]?.focus();
  }
  host.addEventListener('keydown', onKeydown);

  // A resize that only changes the height (the rows just grew) must not lay out again, or it would loop.
  let frame = 0;
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const next = measure();
      if (next !== width) build(next);
    });
  });
  observer?.observe(host);

  build(measure());

  return {
    update(next) {
      books = next;
      open = null;
      build(measure());
    },
    relayout(forWidth) {
      build(forWidth ?? measure());
    },
    destroy() {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      host.removeEventListener('keydown', onKeydown);
      host.replaceChildren();
      host.classList.remove('book-shelf');
    },
  };
}
