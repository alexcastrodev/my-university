export class PapersListPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading', { level: 1, name: 'Papers' });
    this.searchInput = page.getByRole('searchbox', { name: 'Search papers' });
    this.searchButton = page.getByRole('button', { name: 'Search', exact: true });
    this.typeSelect = page.getByLabel('Type', { exact: true });
    this.stageSelect = page.getByLabel('Publication stage', { exact: true });
    this.areaSelect = page.getByLabel('Research area', { exact: true });
    this.sortSelect = page.getByLabel('Sort by', { exact: true });
    this.addPaperLink = page.getByRole('link', { name: 'Add a paper' });
    this.cards = page.locator('.paper-card');
    this.resultsCount = page.locator('.results-count');
    this.noMatches = page.getByText('No papers match your search.');
    this.errorMessage = page.getByText('The papers could not be loaded.');
    this.retryButton = page.getByRole('button', { name: 'Try again' });
    this.clearFilters = page.getByRole('button', { name: 'Clear filters' }).first();
    this.activeFilters = page.locator('.chip-active');
    this.pagination = page.getByRole('navigation', { name: 'Pagination' });
    this.nextLink = this.pagination.getByRole('link', { name: /Next/ });
    this.prevLink = this.pagination.getByRole('link', { name: /Previous/ });
    this.pageStatus = page.locator('.page-status');
  }

  async goto(query = '') {
    await this.page.goto(`/papers${query}`);
  }

  /** The same list in Portuguese. */
  async gotoPortuguese(query = '') {
    await this.page.goto(`/pt-BR/papers${query}`);
  }

  async search(text) {
    await this.searchInput.fill(text);
    await this.searchButton.click();
  }

  card(title) {
    return this.cards.filter({ hasText: title });
  }

  /** The small label saying where a paper stands (Preprint: not reviewed yet, Published...). */
  cardStage(title) {
    return this.card(title).locator('.stage-pill');
  }

  /** The reference tag on top of a row: its place in the result and its DOI ("[1] / DOI 10.1000/x"). */
  cardRef(title) {
    return this.card(title).locator('.row-ref');
  }

  /** The initials of the first authors, drawn instead of photos. */
  cardAvatars(title) {
    return this.card(title).locator('.avatar');
  }

  /** The source links after the excerpt ("DOI", "Page"). */
  cardSource(title, name) {
    return this.card(title).locator('.row-links').getByRole('link', { name, exact: true });
  }

  titles() {
    return this.cards.locator('.paper-title').allTextContents();
  }

  async open(title) {
    await this.card(title).getByRole('link', { name: title }).click();
  }
}
