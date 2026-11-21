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
    this.empty = page.getByText('Your library is empty. Add a paper by its DOI or its PDF, or open one from the list.');
    this.noMatches = page.getByText('No papers in your library match.');
    this.signedOut = page.getByText('Sign in to see your library.');
    this.errorMessage = page.getByText('Your library could not be loaded.');
    this.retryButton = page.getByRole('button', { name: 'Try again' });
    this.clearFilters = page.getByRole('button', { name: 'Clear filters' }).first();
    this.activeFilters = page.locator('.chip-active');
    this.browseLink = page.getByRole('link', { name: 'Browse all papers' }).first();
    this.addPaperLink = page.getByRole('link', { name: 'Add a paper' }).first();

    this.privateBadges = this.cards.locator('.badge-private');

    // Collections (#188): the manager folds away in a <details>, the filter is a select next to the tag one.
    this.manageSummary = page.locator('.manage-summary');
    this.collections = page.locator('app-paper-collections');
    this.collectionName = this.collections.getByLabel('New collection');
    this.createButton = this.collections.getByRole('button', { name: 'Create' });
    this.collectionProblem = this.collections.getByRole('alert');
    this.noCollections = this.collections.getByText('No collections yet.');
    this.collectionSelect = page.getByLabel('Collection', { exact: true });
    this.collectionChips = this.cards.locator('.chip-collection');
  }

  async goto(query = '') {
    await this.page.goto(`/library${query}`);
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

  cardStage(title) {
    return this.card(title).locator('.stage-pill');
  }

  async openCollections() {
    if (!(await this.collections.isVisible())) await this.manageSummary.click();
  }

  /** Runs a change and waits for the API to answer it, whatever it said. */
  async #answered(method, change) {
    const answered = this.page.waitForResponse((r) => r.request().method() === method && r.url().includes('/api/paper-library/collections'));
    await change();
    return answered;
  }

  async createCollection(name) {
    await this.openCollections();
    await this.collectionName.fill(name);
    return this.#answered('POST', () => this.createButton.click());
  }

  collectionRow(name) {
    return this.collections.locator(`li[data-collection="${name}"]`);
  }

  async renameCollection(name, to) {
    const row = this.collectionRow(name);
    await row.getByRole('button', { name: 'Rename' }).click();
    await row.getByLabel('New name').fill(to);
    return this.#answered('PATCH', () => row.getByRole('button', { name: 'Save' }).click());
  }

  /** The first click only asks: the row then says what stays, and the same button confirms. */
  async askToDeleteCollection(name) {
    await this.collectionRow(name).getByRole('button', { name: 'Delete', exact: true }).click();
  }

  deleteConfirmation(name) {
    return this.collectionRow(name).getByText('Delete this collection? Its papers stay in your library.');
  }

  async confirmDeleteCollection(name) {
    return this.#answered('DELETE', () => this.collectionRow(name).getByRole('button', { name: 'Delete', exact: true }).click());
  }

  /** Picks a collection in the filter by its name; the options read "Name (count)". */
  async filterByCollection(name) {
    const value = await this.collectionSelect.locator('option', { hasText: name }).first().getAttribute('value');
    await this.collectionSelect.selectOption(value);
  }

  async open(title) {
    await this.card(title).getByRole('link', { name: title }).click();
  }
}
