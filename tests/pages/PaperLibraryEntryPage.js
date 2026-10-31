export class PaperLibraryEntryPage {
  constructor(page) {
    this.page = page;

    this.title = page.getByRole('heading', { level: 1 });
    this.backLink = page.getByRole('link', { name: /My library/ }).first();
    this.authors = page.locator('.paper-authors');
    this.abstract = page.locator('.abstract');
    this.publicLink = page.getByRole('link', { name: 'View the public page and its discussion' });
    // Where the paper stands, in plain words, next to the title.
    this.stage = page.locator('.stage-note');
    this.stageTitle = this.stage.locator('.stage-title');
    this.stageText = this.stage.locator('.stage-text');
    this.discussion = page.locator('#discussion');
    this.missing = page.getByText('This paper is not in your library.');
    this.signedOut = page.getByText('Sign in to see your library.');
    this.errorMessage = page.getByText('The paper could not be loaded.');
    this.retryButton = page.getByRole('button', { name: 'Try again' });

    this.details = page.locator('app-paper-library-details');
    this.status = this.details.getByLabel('Status', { exact: true });
    this.rating = this.details.getByLabel('Rating (1 to 5)');
    this.completed = this.details.getByLabel('Finished on');
    this.tagInput = this.details.getByLabel('New tag');
    this.tagAdd = this.details.getByRole('button', { name: 'Add', exact: true });
    this.tags = this.details.locator('.tag');
    this.saveError = this.details.getByRole('alert');

    this.remove = page.getByRole('button', { name: 'Remove from library' });
    this.confirmRemove = page.getByRole('button', { name: 'Remove', exact: true });
    this.cancelRemove = page.getByRole('button', { name: 'Cancel' });
    this.removeError = page.locator('.remove').getByRole('alert');

    // A private paper (#203) has no public page and is deleted, not just taken out of the library.
    this.privateBadge = page.locator('.badge-private');
    this.privateNote = page.getByText('Only you can see this paper. It has no public page.');
    this.deletePaper = page.getByRole('button', { name: 'Delete paper' });
    this.confirmDelete = page.getByRole('button', { name: 'Delete', exact: true });
  }

  async goto(id) {
    await this.page.goto(`/library/${id}`);
  }

  /** The value shown next to a label in the facts box (Type, Published, Venue, DOI...). */
  fact(label) {
    return this.page.locator('.fact').filter({ has: this.page.locator('dt', { hasText: label }) }).locator('dd');
  }

  /**
   * Runs a change and waits for the server to answer it, so a navigation or reload right after
   * cannot cut the save off. Not for a change that is meant to fail.
   */
  async #saved(change) {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === 'PATCH' && /\/api\/paper-library\/[a-z0-9-]+$/.test(res.url()),
    );
    await change();
    await answered;
  }

  /** Sets the reading status by its visible name ("To read", "Reading", "Read"). */
  async setStatus(label) {
    await this.#saved(() => this.status.selectOption({ label }));
  }

  async rate(stars) {
    await this.#saved(() => this.rating.selectOption(stars === null ? '' : String(stars)));
  }

  /** The finishing day, as `YYYY-MM-DD`. */
  async finishedOn(day) {
    await this.#saved(() => this.completed.fill(day));
  }

  async addTag(text) {
    await this.tagInput.fill(text);
    await this.#saved(() => this.tagAdd.click());
  }

  tag(text) {
    return this.tags.filter({ hasText: text });
  }

  async removeTag(text) {
    await this.#saved(() => this.tag(text).getByRole('button').click());
  }
}
