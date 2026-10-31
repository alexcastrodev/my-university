/** The PDF reader of a paper in the library (#185): toolbar, search and the pages drawn under them. */
export class PaperReaderPage {
  constructor(page) {
    this.page = page;

    this.bar = page.locator('.bar');
    this.toolbar = page.getByRole('toolbar', { name: 'PDF reader' });
    this.title = this.toolbar.getByRole('heading', { level: 1 });
    this.backLink = this.toolbar.getByRole('link', { name: 'Back to the paper' });
    this.pageInput = this.toolbar.getByLabel('Page number');
    this.pageTotal = this.toolbar.locator('.page-total');
    this.prev = this.toolbar.getByRole('button', { name: 'Previous page' });
    this.next = this.toolbar.getByRole('button', { name: 'Next page' });
    this.zoomOut = this.toolbar.getByRole('button', { name: 'Zoom out' });
    this.zoomIn = this.toolbar.getByRole('button', { name: 'Zoom in' });
    this.zoomLevel = this.toolbar.locator('output');
    this.fitWidth = this.toolbar.getByRole('button', { name: 'Fit width' });
    this.searchToggle = this.toolbar.getByRole('button', { name: 'Search in the document' });

    this.searchInput = page.getByRole('searchbox', { name: 'Search in the document' });
    this.findButton = page.getByRole('button', { name: 'Find', exact: true });
    this.searchStatus = page.locator('.search-status');
    this.prevMatch = page.getByRole('button', { name: 'Previous match' });
    this.nextMatch = page.getByRole('button', { name: 'Next match' });

    this.pages = page.locator('.page');
    this.signedOut = page.getByText('Sign in to see your library.');
    this.missing = page.getByText('This paper is not in your library.');
    this.noFile = page.getByText('This paper has no PDF yet. Upload one on its library page.');
    this.corrupt = page.getByText('This file is not a readable PDF.');
    this.failed = page.getByText('The PDF could not be opened.');
    this.retryButton = page.getByRole('button', { name: 'Try again' });
    this.downloadLink = page.getByRole('link', { name: 'Download the file' });
  }

  async goto(id, prefix = '') {
    await this.page.goto(`${prefix}/library/${id}/read`);
  }

  pageBox(n) {
    return this.page.locator(`.page[data-page="${n}"]`);
  }

  /** The text pdf.js lays over the canvas of a page, once that page is drawn. */
  text(n) {
    return this.pageBox(n).locator('.textLayer');
  }

  /** Waits until a page has its text on screen: the canvas is drawn first, the text follows it. */
  async waitDrawn(n) {
    await this.text(n).locator('span').first().waitFor({ state: 'attached' });
  }

  /** How many pages hold a drawn canvas right now (a page far from the screen gives it back). */
  drawnCount() {
    return this.page.evaluate(() => [...document.querySelectorAll('.page canvas')].filter((c) => c.width > 0).length);
  }

  /** The width of a page as laid out, in pixels. */
  async pageWidth(n) {
    return (await this.pageBox(n).boundingBox()).width;
  }

  /** Types a term and submits it with Enter, which is how a phone does it (its Find button is hidden). */
  async search(term) {
    if (!(await this.searchInput.isVisible())) await this.searchToggle.click();
    await this.searchInput.fill(term);
    await this.searchInput.press('Enter');
  }
}
