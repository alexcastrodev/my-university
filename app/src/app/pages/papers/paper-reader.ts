import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, PLATFORM_ID, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, firstValueFrom, forkJoin, from, map, switchMap, tap } from 'rxjs';
import { Annotation, AnnotationInput, Paper } from '../../models/paper.model';
import { PaperAnnotationsService } from '../../services/paper-annotations.service';
import { PaperAttachmentsService } from '../../services/paper-attachments.service';
import { PaperLibraryService } from '../../services/paper-library.service';
import { SeoService } from '../../services/seo.service';
import { isPaperId } from '../../shared/paper-id';
import { AnnotationItem, annotationKindLabel } from './annotation-item';
import { PageRender, PdfDocument, PdfFailure, closePdf, failureOf, openPdf, pageText } from './pdf-engine';
import { SelectionAnchor, captureSelection } from './pdf-selection';

type State = 'loading' | 'ready' | 'signedOut' | 'missing' | 'noFile' | PdfFailure;

/** What the zoom buttons step through; "fit width" is its own mode and follows the width of the screen. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_FIT = 0.25;
const MAX_FIT = 4;
const GUTTER = 16;
/** Pages this far from the reader (and off screen) give their canvas back. */
const KEEP_PAGES = 3;

/** What an annotation stores about the text it sits on. */
const place = (a: SelectionAnchor) => ({ page: a.page, quote: a.quote, prefix: a.prefix, suffix: a.suffix, rects: a.rects });

/**
 * A paper's own PDF, read inside the app (#185). The bytes come through the authorized attachment route and go
 * straight to pdf.js, which parses in its own worker. Pages are drawn only while they are near the screen, one at
 * a time, so a long document neither freezes the page nor holds every canvas in memory. Client-rendered, private.
 */
@Component({
  selector: 'app-paper-reader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AnnotationItem],
  templateUrl: './paper-reader.html',
  styleUrl: './paper-reader.css',
  host: { '(document:keydown)': 'onKey($event)', '(document:selectionchange)': 'onSelectionChange()' },
})
export class PaperReaderPage {
  private route = inject(ActivatedRoute);
  private library = inject(PaperLibraryService);
  private attachments = inject(PaperAttachmentsService);
  private annotations = inject(PaperAnnotationsService);
  private seo = inject(SeoService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);
  private browser = isPlatformBrowser(inject(PLATFORM_ID));

  private pagesEl = viewChild<ElementRef<HTMLElement>>('pages');
  private barEl = viewChild<ElementRef<HTMLElement>>('bar');

  protected state = signal<State>('loading');
  protected paperId = signal('');
  protected paper = signal<Paper | null>(null);
  protected pageCount = signal(0);
  protected current = signal(1);
  protected pageInput = signal('1');
  /** `fit` follows the width of the screen; a number is a fixed scale (1 is actual size). */
  protected zoomMode = signal<'fit' | number>('fit');
  protected scale = signal(1);
  protected pageNumbers = computed(() => Array.from({ length: this.pageCount() }, (_, i) => i + 1));
  protected zoomPercent = computed(() => Math.round(this.scale() * 100));
  protected canZoomIn = computed(() => this.scale() < ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001);
  protected canZoomOut = computed(() => this.scale() > ZOOM_STEPS[0] + 0.001);
  protected fileUrl = computed(() => this.attachments.fileUrl(this.paperId()));

  protected searchOpen = signal(false);
  protected query = signal('');
  protected searching = signal(false);
  protected searched = signal(false);
  /** One entry per match, holding its page. A match is found in the page's text, the highlight marks the text pieces holding the term. */
  protected hits = signal<number[]>([]);
  protected hitIndex = signal(0);
  protected matchesLabel = computed(() => {
    const n = this.hits().length;
    return n === 1 ? $localize`:@@papers.reader.match.one:1 match` : $localize`:@@papers.reader.match.many:${n}:count: matches`;
  });

  // Highlights, comments, questions and bookmarks (#186): the reader's own marks on this PDF.
  protected items = signal<Annotation[]>([]);
  protected pdfVersion = signal<number | null>(null);
  protected annotationsFailed = signal(false);
  protected annotationError = signal<'save' | 'stale' | null>(null);
  protected panelOpen = signal(false);
  protected selection = signal<SelectionAnchor | null>(null);
  protected draft = signal<{ kind: 'comment' | 'question'; anchor: SelectionAnchor } | null>(null);
  protected draftText = signal('');
  protected busyId = signal<string | null>(null);
  protected flashId = signal<string | null>(null);
  protected barHeight = signal(0);
  protected kindLabel = annotationKindLabel;
  /** True while a finger or a pointer is on the selection bar: tapping it must not drop the selection it acts on. */
  protected holdSelection = false;

  /** What is drawn on this PDF, by the page it is on. A stale annotation is never drawn on a file it was not made for. */
  protected live = computed(() =>
    this.items()
      .filter((a) => a.kind !== 'note' && !a.stale)
      .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.createdAt.localeCompare(b.createdAt)),
  );
  protected review = computed(() => this.items().filter((a) => a.kind !== 'note' && a.stale));
  protected byPage = computed(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of this.live()) map.set(a.page!, [...(map.get(a.page!) ?? []), a]);
    return map;
  });
  protected bookmark = computed(() => this.live().find((a) => a.kind === 'bookmark' && a.page === this.current()) ?? null);
  protected canSaveDraft = computed(() => this.draftText().trim().length > 0 && !this.busyId());

  protected onPage(n: number): Annotation[] {
    return this.byPage().get(n) ?? [];
  }

  protected pageLabel = (n: number) => $localize`:@@papers.reader.pageLabel:Page ${n}:page:`;

  /** The first page at scale 1: every placeholder is that size until its own page is drawn. */
  private base = { w: 612, h: 792 };
  private sizes = signal(new Map<number, { w: number; h: number }>());
  private doc?: PdfDocument;
  private rendered = new Map<number, PageRender>();
  private visible = new Set<number>();
  private observer?: IntersectionObserver;
  private resizer?: ResizeObserver;
  private detach?: () => void;
  private frame = 0;
  private pumping = false;
  private pumpAgain = false;
  private lastWidth = 0;
  private text = new Map<number, string>();
  private searchToken = 0;
  private loadToken = 0;
  private term = '';
  private request = new Subject<string>();

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
    this.request
      .pipe(
        tap((id) => {
          this.dispose();
          this.paperId.set(id);
          this.state.set('loading');
        }),
        switchMap((id) => from(this.load(id))),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
    this.route.paramMap.pipe(map((p) => p.get('paperId') ?? ''), takeUntilDestroyed()).subscribe((id) => this.request.next(id));

    // The pages exist once the state is `ready`; the observers need them.
    effect(() => {
      const pages = this.pagesEl()?.nativeElement;
      if (pages) untracked(() => this.attach(pages));
    });
  }

  protected retry(): void {
    this.request.next(this.paperId());
  }

  protected box(n: number): { w: number; h: number } {
    return this.sizes().get(n) ?? { w: this.base.w * this.scale(), h: this.base.h * this.scale() };
  }

  protected goTo(n: number): void {
    const target = Math.min(Math.max(Math.round(n) || 1, 1), this.pageCount());
    this.current.set(target);
    this.pageInput.set(String(target));
    this.scrollToPage(target);
    void this.pump();
  }

  protected onPageSubmit(event: Event): void {
    event.preventDefault();
    this.goTo(Number(this.pageInput()));
  }

  protected zoomIn(): void {
    const next = ZOOM_STEPS.find((z) => z > this.scale() * 1.01);
    if (next) this.setZoom(next);
  }

  protected zoomOut(): void {
    const previous = [...ZOOM_STEPS].reverse().find((z) => z < this.scale() / 1.01);
    if (previous) this.setZoom(previous);
  }

  protected fitWidth(): void {
    this.setZoom('fit');
  }

  protected toggleSearch(): void {
    this.searchOpen.update((open) => !open);
    // The field exists only after this change is rendered.
    if (this.searchOpen()) afterNextRender(() => document.getElementById('reader-search')?.focus(), { injector: this.injector });
  }

  protected async onSearch(event: Event): Promise<void> {
    event.preventDefault();
    const doc = this.doc;
    const term = this.query().trim().toLowerCase();
    const token = ++this.searchToken;
    this.term = term;
    this.hits.set([]);
    this.hitIndex.set(0);
    this.searched.set(false);
    this.highlightAll();
    if (!doc || !term) {
      this.searching.set(false);
      return;
    }

    this.searching.set(true);
    const found: number[] = [];
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        let text = this.text.get(n);
        if (text === undefined) {
          text = await pageText(await doc.getPage(n));
          this.text.set(n, text);
        }
        if (token !== this.searchToken) return;
        for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) found.push(n);
      }
    } catch {
      // A page whose text cannot be read is skipped: the matches found so far are still useful.
    }
    if (token !== this.searchToken) return;
    this.searching.set(false);
    this.searched.set(true);
    this.hits.set(found);
    this.highlightAll();
    if (found.length) this.goTo(found[0]);
  }

  protected step(direction: 1 | -1): void {
    const hits = this.hits();
    if (!hits.length) return;
    const index = (this.hitIndex() + direction + hits.length) % hits.length;
    this.hitIndex.set(index);
    this.goTo(hits[index]);
  }

  protected onKey(event: KeyboardEvent): void {
    if (this.state() !== 'ready' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
    switch (event.key) {
      case 'n':
        this.goTo(this.current() + 1);
        break;
      case 'p':
        this.goTo(this.current() - 1);
        break;
      case 'Home':
        this.goTo(1);
        break;
      case 'End':
        this.goTo(this.pageCount());
        break;
      case '+':
      case '=':
        this.zoomIn();
        break;
      case '-':
        this.zoomOut();
        break;
      case '0':
        this.fitWidth();
        break;
      // Not "/": that opens the search of the whole site.
      case 'f':
        if (!this.searchOpen()) this.toggleSearch();
        else document.getElementById('reader-search')?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** The marks the reader made on this PDF. Reading the PDF does not depend on them, so a failure only says so in the panel. */
  private async loadAnnotations(id: string, token: number): Promise<void> {
    try {
      const list = await firstValueFrom(this.annotations.list(id));
      if (token !== this.loadToken) return;
      this.items.set(list.items);
      this.pdfVersion.set(list.version);
      this.annotationsFailed.set(false);
    } catch {
      if (token === this.loadToken) this.annotationsFailed.set(true);
    }
  }

  protected onSelectionChange(): void {
    if (this.state() !== 'ready' || this.holdSelection) return;
    this.selection.set(captureSelection(this.pagesEl()?.nativeElement));
  }

  protected clearSelection(): void {
    window.getSelection()?.removeAllRanges();
    this.selection.set(null);
  }

  protected async highlightSelection(): Promise<void> {
    const anchor = this.selection();
    if (anchor && (await this.add({ kind: 'highlight', ...place(anchor) }))) this.clearSelection();
  }

  /** Comments and questions are written in the panel, next to the text they are about. */
  protected startDraft(kind: 'comment' | 'question'): void {
    const anchor = this.selection();
    if (!anchor) return;
    this.draft.set({ kind, anchor });
    this.draftText.set('');
    this.panelOpen.set(true);
    this.clearSelection();
    afterNextRender(() => document.getElementById('annotation-draft')?.focus(), { injector: this.injector });
  }

  protected async saveDraft(event: Event): Promise<void> {
    event.preventDefault();
    const draft = this.draft();
    const body = this.draftText().trim();
    if (draft && body && (await this.add({ kind: draft.kind, body, ...place(draft.anchor) }))) this.draft.set(null);
  }

  protected toggleBookmark(): Promise<void> {
    const mark = this.bookmark();
    return mark ? this.drop(mark) : this.add({ kind: 'bookmark', page: this.current() }).then(() => undefined);
  }

  protected edit(a: Annotation, body: string): Promise<void> {
    return this.change(a, { body });
  }

  protected keep(a: Annotation): Promise<void> {
    return this.change(a, { kind: 'note' });
  }

  /** Takes the reader to where an annotation is, and flashes it. On a phone the panel gets out of the way. */
  protected show(a: Annotation): void {
    if (!a.page) return;
    this.goTo(a.page);
    this.flashId.set(a.id);
    setTimeout(() => this.flashId.update((id) => (id === a.id ? null : id)), 1800);
    if (window.matchMedia('(max-width: 768px)').matches) this.panelOpen.set(false);
  }

  protected async drop(a: Annotation): Promise<void> {
    this.busyId.set(a.id);
    this.annotationError.set(null);
    try {
      await firstValueFrom(this.annotations.remove(this.paperId(), a.id));
      this.items.update((list) => list.filter((x) => x.id !== a.id));
    } catch (err) {
      this.fail(err);
    } finally {
      this.busyId.set(null);
    }
  }

  private async change(a: Annotation, patch: { body?: string; kind?: 'note' }): Promise<void> {
    this.busyId.set(a.id);
    this.annotationError.set(null);
    try {
      const next = await firstValueFrom(this.annotations.update(this.paperId(), a.id, patch));
      this.items.update((list) => list.map((x) => (x.id === a.id ? next : x)));
    } catch (err) {
      this.fail(err);
    } finally {
      this.busyId.set(null);
    }
  }

  /** Saves a new mark on the PDF being read; the server refuses it if that is no longer the PDF of the paper. */
  private async add(input: AnnotationInput): Promise<boolean> {
    const version = this.pdfVersion();
    if (version === null) return false;
    this.busyId.set('new');
    this.annotationError.set(null);
    try {
      const made = await firstValueFrom(this.annotations.create(this.paperId(), { ...input, version }));
      this.items.update((list) => [...list, made]);
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    } finally {
      this.busyId.set(null);
    }
  }

  private fail(err: unknown): void {
    const replaced = err instanceof HttpErrorResponse && err.status === 409 && err.error?.code === 'stale_version';
    this.annotationError.set(replaced ? 'stale' : 'save');
  }

  /** Fetches the record and the file, opens it, and says what the reader should see. */
  private async load(id: string): Promise<State> {
    if (!isPaperId(id) || !this.browser) return 'missing';
    const token = ++this.loadToken;
    try {
      const [entry, paper] = await firstValueFrom(forkJoin([this.library.get(id), this.library.paper(id)]));
      if (!entry) return 'missing';
      this.paper.set(paper);
      this.seo.set({ title: paper.title, description: 'A paper in your library.', path: `/library/${id}/read`, noindex: true });
      const bytes = await firstValueFrom(this.attachments.file(id));
      if (!bytes) return 'noFile';
      const doc = await openPdf(new Uint8Array(bytes));
      if (token !== this.loadToken) {
        void closePdf(doc);
        return 'loading';
      }
      await this.loadAnnotations(id, token);
      if (token !== this.loadToken) {
        void closePdf(doc);
        return 'loading';
      }
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      this.doc = doc;
      this.base = { w: first.width, h: first.height };
      this.pageCount.set(doc.numPages);
      this.current.set(1);
      this.pageInput.set('1');
      return 'ready';
    } catch (err) {
      if (err instanceof HttpErrorResponse) return err.status === 401 ? 'signedOut' : err.status === 404 ? 'missing' : 'failed';
      return failureOf(err);
    }
  }

  /** Starts watching the pages (which are near the screen, to draw them) and the width (to fit it). */
  private attach(pages: HTMLElement): void {
    this.lastWidth = pages.clientWidth;
    this.applyScale();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset['page']);
          if (entry.isIntersecting) this.visible.add(n);
          else this.visible.delete(n);
        }
        void this.pump();
        this.trackCurrent();
      },
      { rootMargin: '100% 0px' },
    );
    pages.querySelectorAll('.page').forEach((el) => this.observer!.observe(el));
    const bar = this.barEl()?.nativeElement;
    this.resizer = new ResizeObserver(() => {
      if (bar) this.barHeight.set(bar.offsetHeight);
      const width = pages.clientWidth;
      if (Math.abs(width - this.lastWidth) < 2) return;
      this.lastWidth = width;
      if (this.zoomMode() === 'fit') this.applyScale();
    });
    this.resizer.observe(pages);
    if (bar) this.resizer.observe(bar);
    // Captured, so a scroll inside any container is seen, not just the window's.
    const onScroll = () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.trackCurrent());
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    this.detach = () => document.removeEventListener('scroll', onScroll, { capture: true });
  }

  /** The page the reader is on: the first one that still reaches below the top third of the screen. */
  private trackCurrent(): void {
    const line = window.innerHeight * 0.35;
    for (const n of [...this.visible].sort((a, b) => a - b)) {
      const rect = this.pageEl(n)?.getBoundingClientRect();
      if (rect && rect.bottom > line) {
        this.current.set(n);
        if (document.activeElement?.id !== 'reader-page') this.pageInput.set(String(n));
        return;
      }
    }
  }

  /** Puts a page right under the bar that stays on top, whatever height the bar has on this screen. */
  private scrollToPage(n: number): void {
    const el = this.pageEl(n);
    if (!el) return;
    const under = this.barEl()?.nativeElement.getBoundingClientRect().bottom ?? 0;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - under - 8 });
  }

  private setZoom(mode: 'fit' | number): void {
    this.zoomMode.set(mode);
    this.applyScale();
  }

  /** The scale follows the zoom mode; every drawn page is dropped and the ones on screen are drawn again. */
  private applyScale(): void {
    const width = (this.pagesEl()?.nativeElement.clientWidth ?? 0) - 2 * GUTTER;
    const mode = this.zoomMode();
    const scale = mode === 'fit' ? Math.min(Math.max(width / this.base.w, MIN_FIT), MAX_FIT) : mode;
    const before = this.current();
    this.scale.set(scale);
    this.sizes.set(new Map());
    for (const n of [...this.rendered.keys()]) this.release(n);
    this.goTo(before);
  }

  private pageEl(n: number): HTMLElement | null {
    return this.pagesEl()?.nativeElement.querySelector<HTMLElement>(`[data-page="${n}"]`) ?? null;
  }

  /** Draws the pages near the screen, one at a time, nearest to the reader first; gives back the far ones. */
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
        const here = this.current();
        for (const n of [...this.rendered.keys()]) {
          if (Math.abs(n - here) > KEEP_PAGES && !this.visible.has(n)) this.release(n);
        }
        const wanted = [...this.visible].filter((n) => !this.rendered.has(n)).sort((a, b) => Math.abs(a - here) - Math.abs(b - here));
        for (const n of wanted) {
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
    const el = this.pageEl(n);
    const canvas = el?.querySelector('canvas');
    const layer = el?.querySelector<HTMLElement>('.textLayer');
    if (!doc || !el || !canvas || !layer) return;
    const scale = this.scale();
    try {
      const page = await doc.getPage(n);
      const render = new PageRender(page, scale, canvas, layer);
      this.rendered.set(n, render);
      const divs = await render.done;
      const size = page.getViewport({ scale });
      this.sizes.update((m) => new Map(m).set(n, { w: size.width, h: size.height }));
      this.highlight(divs);
    } catch {
      // Cancelled (the page left the screen or the zoom changed) or this one page failed: the rest of the document stays usable.
      this.rendered.delete(n);
    }
  }

  private release(n: number): void {
    this.rendered.get(n)?.cancel();
    this.rendered.delete(n);
    const el = this.pageEl(n);
    const canvas = el?.querySelector('canvas');
    if (canvas) canvas.width = 0;
    el?.querySelector('.textLayer')?.replaceChildren();
  }

  private highlight(divs: Iterable<HTMLElement>): void {
    for (const div of divs) div.classList.toggle('hit', !!this.term && (div.textContent ?? '').toLowerCase().includes(this.term));
  }

  private highlightAll(): void {
    for (const n of this.rendered.keys()) this.highlight(this.pageEl(n)?.querySelectorAll<HTMLElement>('.textLayer > span') ?? []);
  }

  private dispose(): void {
    this.searchToken++;
    this.loadToken++;
    this.observer?.disconnect();
    this.resizer?.disconnect();
    this.detach?.();
    cancelAnimationFrame(this.frame);
    for (const render of this.rendered.values()) render.cancel();
    this.rendered.clear();
    this.visible.clear();
    this.text.clear();
    if (this.doc) void closePdf(this.doc);
    this.doc = undefined;
    this.observer = this.resizer = this.detach = undefined;
    this.pageCount.set(0);
    this.items.set([]);
    this.pdfVersion.set(null);
    this.selection.set(null);
    this.draft.set(null);
    this.annotationError.set(null);
    this.annotationsFailed.set(false);
    this.sizes.set(new Map());
    this.hits.set([]);
    this.searched.set(false);
    this.term = '';
  }
}
