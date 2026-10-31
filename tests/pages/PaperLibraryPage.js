export class PaperLibraryPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading', { level: 1, name: 'My library' });
    this.statusTabs = page.getByRole('navigation', { name: 'Reading status' });
    this.searchInput = page.getByRole('searchbox', { name: 'Search your library' });
    this.searchButton = page.getByRole('button', { name: 'Search', exact: true });
    this.tagSelect = page.getByLabel('Tag', { exact: true });
    this.sortSelect = page.getByLabel('Sort by', { exact: true });
    this.cards = page.locator('.paper-card');
    this.cardTitles = this.cards.locator('.paper-title');
    this.resultsCount = page.locator('.results-count');
    this.empty = page.getByText('Your library is empty. Open a paper and add it to start.');
    this.noMatches = page.getByText('No papers in your library match.');
    this.signedOut = page.getByText('Sign in to see your library.');
    this.errorMessage = page.getByText('Your library could not be loaded.');
    this.retryButton = page.getByRole('button', { name: 'Try again' });
    this.clearFilters = page.getByRole('button', { name: 'Clear filters' }).first();
    this.activeFilters = page.locator('.chip-active');
    this.browseLink = page.getByRole('link', { name: 'Browse all papers' }).first();
  }

  async goto(query = '') {
    await this.page.goto(`/papers/library${query}`);
  }

  /** A status tab by its visible name ("All", "To read", "Reading", "Read"). */
  tab(name) {
    return this.statusTabs.getByRole('link', { name: new RegExp(`^\\s*${name}\\s*\\d*\\s*$`) });
  }

  async search(text) {
    await this.searchInput.fill(text);
    await this.searchButton.click();
  }

  card(title) {
    return this.cards.filter({ hasText: title });
  }

  async open(title) {
    await this.card(title).getByRole('link', { name: title }).click();
  }
}
