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

    // What the reader marks on the PDF (#186).
    this.bookmarkButton = this.toolbar.getByRole('button', { name: 'Bookmark this page' });
    this.annotationsButton = this.toolbar.getByRole('button', { name: 'Annotations' });
    this.panel = page.locator('#reader-panel');
    this.closePanel = this.panel.getByRole('button', { name: 'Close the annotations' });
    this.panelEmpty = this.panel.getByText('Select text to highlight it');
    this.selectionBar = page.getByRole('toolbar', { name: 'Selected text' });
    this.highlightButton = this.selectionBar.getByRole('button', { name: 'Highlight' });
    this.commentButton = this.selectionBar.getByRole('button', { name: 'Comment' });
    this.questionButton = this.selectionBar.getByRole('button', { name: 'Question' });
    this.draftField = page.locator('#annotation-draft');
    this.draftSave = this.panel.locator('form.draft').getByRole('button', { name: 'Save' });
    this.notice = page.locator('.notice');
    this.reloadButton = this.notice.getByRole('button', { name: 'Reload' });
    this.needsReview = this.panel.locator('#reader-needs-review');

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

  /** Scrolls a page into view and waits for its text: a page far from the screen is not drawn until the reader gets there. */
  async reveal(n) {
    await this.pageBox(n).scrollIntoViewIfNeeded();
    await this.waitDrawn(n);
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
  /** The colored boxes drawn over a page for the annotations of one kind. */
  marks(n, kind) {
    return this.pageBox(n).locator(`.mark[data-kind="${kind}"]`);
  }

  ribbon(n) {
    return this.pageBox(n).locator('.ribbon');
  }

  /** The annotations the panel lists, by kind. */
  panelItems(kind) {
    return this.panel.locator(`app-annotation-item article[data-kind="${kind}"]`);
  }

  /** Selects part of the text of a page the way the mouse does: a range over the text pdf.js laid there. */
  async select(n, text) {
    await this.reveal(n);
    const found = await this.text(n).evaluate((layer, wanted) => {
      for (const span of layer.querySelectorAll('span')) {
        const node = span.firstChild;
        const at = node?.textContent?.indexOf(wanted) ?? -1;
        if (!node || at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      return false;
    }, text);
    if (!found) throw new Error(`"${text}" is not in the text of page ${n}`);
  }

  /** Runs a change and waits for the server's answer to the annotations call. */
  async #answered(method, change) {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === method && /\/api\/paper-library\/[a-z0-9-]+\/annotations(\/|$)/.test(res.url()),
    );
    await change();
    return answered;
  }

  async highlight(n, text) {
    await this.select(n, text);
    await this.highlightButton.waitFor();
    return this.#answered('POST', () => this.highlightButton.click());
  }

  /** Comment or question: the text is written in the panel, next to what was selected. */
  async annotate(kind, n, text, body) {
    await this.select(n, text);
    const button = kind === 'comment' ? this.commentButton : this.questionButton;
    await button.waitFor();
    await button.click();
    await this.draftField.fill(body);
    return this.#answered('POST', () => this.draftSave.click());
  }

  async toggleBookmark() {
    const method = (await this.bookmarkButton.getAttribute('aria-pressed')) === 'true' ? 'DELETE' : 'POST';
    return this.#answered(method, () => this.bookmarkButton.click());
  }

  async openPanel() {
    if (!(await this.panel.isVisible())) await this.annotationsButton.click();
  }
  /**
   * How far, in pixels, the first mark of a kind on a page is from the text it should cover: the largest
   * difference between their edges. Null while the mark or the text is not on screen yet.
   */
  async offset(n, text, kind) {
    const mark = await this.marks(n, kind).first().boundingBox();
    if (!mark) return null;
    const range = await this.text(n).evaluate((layer, wanted) => {
      for (const span of layer.querySelectorAll('span')) {
        const node = span.firstChild;
        const at = node?.textContent?.indexOf(wanted) ?? -1;
        if (!node || at < 0) continue;
        const r = document.createRange();
        r.setStart(node, at);
        r.setEnd(node, at + wanted.length);
        const { left, top, right, bottom } = r.getBoundingClientRect();
        return { left, top, right, bottom };
      }
      return null;
    }, text);
    if (!range) return null;
    return Math.max(
      Math.abs(mark.x - range.left),
      Math.abs(mark.y - range.top),
      Math.abs(mark.x + mark.width - range.right),
      Math.abs(mark.y + mark.height - range.bottom),
    );
  }
  /** Deletes the first annotation of a kind from the panel, which asks once more. */
  async deleteMark(kind) {
    const item = this.panelItems(kind).first();
    await item.getByRole('button', { name: 'Delete' }).click();
    return this.#answered('DELETE', () => item.getByRole('button', { name: 'Delete' }).click());
  }
}
