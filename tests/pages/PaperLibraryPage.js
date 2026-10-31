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

    // The drop zone for a paper that is not in the catalog (#203), and the form that follows a chosen file.
    this.drop = page.locator('app-paper-private-drop');
    this.dropZone = this.drop.locator('.drop-zone');
    this.fileInput = this.drop.locator('input[type="file"]');
    this.titleInput = this.drop.getByLabel('Title', { exact: true });
    this.doiInput = this.drop.getByLabel('DOI (optional)');
    this.addButton = this.drop.getByRole('button', { name: 'Add to my library' });
    this.cancelButton = this.drop.getByRole('button', { name: 'Cancel' });
    this.dropError = this.drop.getByRole('alert');
    this.dropDone = this.drop.locator('.drop-done');
    this.openLink = this.drop.getByRole('link', { name: 'Open' });
    this.privateBadges = this.cards.locator('.badge-private');
  }

  /** Picks a PDF with the file chooser (what a phone does); the form with the title opens. */
  async choose({ name, buffer, mimeType = 'application/pdf' }) {
    await this.fileInput.setInputFiles({ name, mimeType, buffer });
  }

  /** Drops a PDF on the zone the way the browser does it: a dragover, then a drop carrying the file. */
  async dropFile({ name, buffer, mimeType = 'application/pdf' }) {
    const data = await this.page.evaluateHandle(
      ({ name, bytes, mimeType }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }));
        return transfer;
      },
      { name, bytes: [...buffer], mimeType },
    );
    await this.dropZone.dispatchEvent('dragover', { dataTransfer: data });
    await this.dropZone.dispatchEvent('drop', { dataTransfer: data });
  }

  /** Sends the form and waits for the API to answer it, whatever it said. */
  async submit() {
    const sent = this.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/paper-library/private'));
    await this.addButton.click();
    return sent;
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

  async open(title) {
    await this.card(title).getByRole('link', { name: title }).click();
  }
}
