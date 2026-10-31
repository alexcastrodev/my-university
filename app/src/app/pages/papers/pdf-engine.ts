import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

/** The one place that knows which PDF engine the reader uses (pdf.js, see docs/pdf-engine-evaluation.md). */
type PdfJs = typeof import('pdfjs-dist');

export type PdfDocument = PDFDocumentProxy;
export type PdfPage = PDFPageProxy;

/** Why a PDF could not be shown, as the reader tells it to a person. */
export type PdfFailure = 'corrupt' | 'encrypted' | 'memory' | 'failed';

/** The most pixels one page canvas may hold, so a deep zoom on a big page cannot exhaust memory. */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
/** The largest image pdf.js will decode, in pixels. */
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;

/** The engine's own files (worker, fonts, character maps) are served from our origin, next to the app. */
const assetUrl = (path: string) => new URL(path, document.baseURI).href;

let engine: Promise<PdfJs> | undefined;

/** pdf.js is large: it is fetched on first use, in the browser only, and its worker runs off the main thread. */
export function loadEngine(): Promise<PdfJs> {
  engine ??= import('pdfjs-dist')
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('pdfjs/pdf.worker.min.mjs');
      return pdfjs;
    })
    .catch((err) => {
      engine = undefined;
      throw err;
    });
  return engine;
}

/**
 * Opens a PDF from its bytes, which came through the authorized attachment route: nothing is fetched by URL.
 * Nothing in the file is run. This build of pdf.js has no eval path, scripting only exists behind the
 * annotation layer (which the reader never creates) and XFA forms are off.
 */
export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const pdfjs = await loadEngine();
  return pdfjs.getDocument({
    data: bytes,
    enableXfa: false,
    maxImageSize: MAX_IMAGE_PIXELS,
    cMapUrl: assetUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
    iccUrl: assetUrl('pdfjs/iccs/'),
    // The page's CSP does not allow compiling WebAssembly, so the engine falls back to the plain JavaScript decoders next to these.
    wasmUrl: assetUrl('pdfjs/wasm/'),
  }).promise;
}

/** Gives back the document and the worker that parsed it. */
export function closePdf(doc: PdfDocument): Promise<void> {
  return doc.loadingTask.destroy();
}

export function failureOf(err: unknown): PdfFailure {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'PasswordException') return 'encrypted';
  if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'MissingPDFException') return 'corrupt';
  if (err instanceof RangeError || /memory/i.test(String((err as Error | null)?.message))) return 'memory';
  return 'failed';
}

/** A page being drawn: the canvas first, then the text on top of it that can be selected and searched. */
export class PageRender {
  private task?: RenderTask;
  private cancelled = false;
  private cancelText?: () => void;

  /** Resolves with the text elements once the page is drawn; rejects if it was cancelled or failed. */
  readonly done: Promise<HTMLElement[]>;

  constructor(page: PdfPage, scale: number, canvas: HTMLCanvasElement, textLayer: HTMLElement) {
    this.done = this.run(page, scale, canvas, textLayer);
  }

  cancel(): void {
    this.cancelled = true;
    this.task?.cancel();
    this.cancelText?.();
  }

  private async run(page: PdfPage, scale: number, canvas: HTMLCanvasElement, textLayer: HTMLElement): Promise<HTMLElement[]> {
    const pdfjs = await loadEngine();
    const viewport = page.getViewport({ scale });
    // Sharp on dense screens, but never more pixels than the cap.
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    ratio = Math.min(ratio, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    this.task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
    await this.task.promise;
    if (this.cancelled) throw new Error('cancelled');

    textLayer.replaceChildren();
    textLayer.style.setProperty('--total-scale-factor', String(scale));
    const text = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
    this.cancelText = () => text.cancel();
    await text.render();
    return text.textDivs;
  }
}

/** The text of a page as one lowercase string, for the search. */
export async function pageText(page: PdfPage): Promise<string> {
  const content = await page.getTextContent();
  return content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ')
    .toLowerCase();
}
