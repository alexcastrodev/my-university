import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, PLATFORM_ID, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { PageRender, PdfDocument, PdfFailure, closePdf, failureOf, openPdf } from './pdf-engine';

type State = 'closed' | 'loading' | 'ready' | 'missing' | PdfFailure;

/** Pages this far from the ones on screen give their canvas back. */
const KEEP_PAGES = 3;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

/**
 * The full text of a public paper, read in the page (#185's engine, without the library around it): once the page
 * has rendered in the browser it fetches the PDF behind the paper's `paperUrl` through the API
 * (`/api/papers/:slug/full-text`, which checks it) and pdf.js draws the pages that are near the screen, a few at a
 * time, fitted to the width of the column. The pages run with the page's own scroll, not in a box of their own.
 * Nothing happens on the server. A link that does not give a PDF shows "Preview not available".
 */
@Component({
  selector: 'app-paper-full-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paper-full-text.html',
  styleUrl: './paper-full-text.css',
})
export class PaperFullText {
  readonly slug = input.required<string>();

  private http = inject(HttpClient);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));
  private pagesEl = viewChild<ElementRef<HTMLElement>>('pages');

  protected state = signal<State>('loading');
  protected pageCount = signal(0);
  protected scale = signal(1);
  protected pageNumbers = computed(() => Array.from({ length: this.pageCount() }, (_, i) => i + 1));
  protected sizes = signal(new Map<number, { w: number; h: number }>());
  protected pageLabel = (n: number) => $localize`:@@papers.reader.pageLabel:Page ${n}:page:`;

  private doc?: PdfDocument;
  private base = { w: 612, h: 792 };
  private rendered = new Map<number, PageRender>();
  private visible = new Set<number>();
  private observer?: IntersectionObserver;
  private resizer?: ResizeObserver;
  private lastWidth = 0;
  private pumping = false;
  private pumpAgain = false;
  private token = 0;
  private busy = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());
    afterNextRender(() => void this.open());
    // The pages exist once the state is `ready`; the observers need them.
    effect(() => {
      const pages = this.pagesEl()?.nativeElement;
      if (pages) untracked(() => this.attach(pages));
    });
  }

  protected box(n: number): { w: number; h: number } {
    return this.sizes().get(n) ?? { w: this.base.w * this.scale(), h: this.base.h * this.scale() };
  }

  protected async open(): Promise<void> {
    if (!this.browser || this.busy || this.state() === 'ready') return;
    this.busy = true;
    const token = ++this.token;
    this.state.set('loading');
    try {
      const bytes = await firstValueFrom(this.http.get(`/api/papers/${this.slug()}/full-text`, { responseType: 'arraybuffer' }));
      const doc = await openPdf(new Uint8Array(bytes));
      if (token !== this.token) {
        void closePdf(doc);
        return;
      }
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      this.doc = doc;
      this.base = { w: first.width, h: first.height };
      this.pageCount.set(doc.numPages);
      this.state.set('ready');
    } catch (err) {
      if (token !== this.token) return;
      this.state.set(err instanceof HttpErrorResponse ? (err.status === 404 ? 'missing' : 'failed') : failureOf(err));
    } finally {
      this.busy = false;
    }
  }

  protected close(): void {
    this.token++;
    this.dispose();
    this.state.set('closed');
  }

  /** Starts watching the pages (which are near the screen, to draw them) and the width (to fit it). */
  private attach(pages: HTMLElement): void {
    this.lastWidth = pages.clientWidth;
    this.applyScale(pages);
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset['page']);
          if (entry.isIntersecting) this.visible.add(n);
          else this.visible.delete(n);
        }
        void this.pump();
      },
      { rootMargin: '100% 0px' },
    );
    pages.querySelectorAll('.page').forEach((el) => this.observer!.observe(el));
    this.resizer = new ResizeObserver(() => {
      const width = pages.clientWidth;
      if (Math.abs(width - this.lastWidth) < 2) return;
      this.lastWidth = width;
      this.applyScale(pages);
    });
    this.resizer.observe(pages);
  }

  /** Fits the pages to the column; a new scale means every drawn page is drawn again. */
  private applyScale(pages: HTMLElement): void {
    const fit = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pages.clientWidth / this.base.w));
    if (Math.abs(fit - this.scale()) < 0.001) return;
    for (const n of [...this.rendered.keys()]) this.release(n);
    this.sizes.set(new Map());
    this.scale.set(fit);
    void this.pump();
  }

  /** Draws the pages near the screen, one at a time; gives back the far ones. */
  private async pump(): Promise<void> {
    if (!this.doc) return;
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        const near = [...this.visible];
        if (near.length) {
          const first = Math.min(...near);
          const last = Math.max(...near);
          for (const n of [...this.rendered.keys()]) if (n < first - KEEP_PAGES || n > last + KEEP_PAGES) this.release(n);
        }
        for (const n of near.filter((p) => !this.rendered.has(p)).sort((a, b) => a - b)) {
          if (this.pumpAgain) break;
          await this.draw(n);
        }
      } while (this.pumpAgain);
    } finally {
      this.pumping = false;
    }
  }

  private async draw(n: number): Promise<void> {
    const doc = this.doc;
    const el = this.pagesEl()?.nativeElement.querySelector<HTMLElement>(`[data-page="${n}"]`);
    const canvas = el?.querySelector('canvas');
    const layer = el?.querySelector<HTMLElement>('.textLayer');
    if (!doc || !canvas || !layer) return;
    const scale = this.scale();
    try {
      const page = await doc.getPage(n);
      const render = new PageRender(page, scale, canvas, layer);
      this.rendered.set(n, render);
      await render.done;
      const size = page.getViewport({ scale });
      this.sizes.update((m) => new Map(m).set(n, { w: size.width, h: size.height }));
    } catch {
      // Cancelled (the page left the screen or the width changed) or this one page failed: the rest stays readable.
      this.rendered.delete(n);
    }
  }

  private release(n: number): void {
    this.rendered.get(n)?.cancel();
    this.rendered.delete(n);
    const el = this.pagesEl()?.nativeElement.querySelector<HTMLElement>(`[data-page="${n}"]`);
    const canvas = el?.querySelector('canvas');
    if (canvas) canvas.width = 0;
    el?.querySelector('.textLayer')?.replaceChildren();
  }

  private dispose(): void {
    this.observer?.disconnect();
    this.resizer?.disconnect();
    for (const render of this.rendered.values()) render.cancel();
    this.rendered.clear();
    this.visible.clear();
    if (this.doc) void closePdf(this.doc);
    this.doc = undefined;
    this.observer = this.resizer = undefined;
    this.pageCount.set(0);
    this.sizes.set(new Map());
    this.scale.set(1);
  }
}
