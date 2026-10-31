import { PaperLayout } from './PaperLayout.js';

export class PaperLibraryEntryPage {
  constructor(page) {
    this.page = page;

    // The reading controls, the PDF and the facts sit in the aside, beside the body on a wide screen.
    this.layout = new PaperLayout(page);
    this.aside = this.layout.aside;
    this.body = this.layout.body;
    this.sideDetails = this.aside.locator('app-paper-library-details');
    this.sidePdf = this.aside.locator('.attachment');
    this.sideFacts = this.aside.locator('.facts');
    this.sideRemove = this.aside.locator('.remove');
    this.bodyAbstract = this.body.locator('.abstract');
    this.bodyNotes = this.body.locator('#notes');

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

    // Collections (#188): one checkbox per collection the reader has.
    this.collectionList = this.details.locator('.collection-list');
    this.noCollections = this.details.getByText('You have no collections yet.');
    this.makeCollectionLink = this.details.getByRole('link', { name: 'Make one in your library.' });

    this.remove = page.getByRole('button', { name: 'Remove from library' });
    this.confirmRemove = page.getByRole('button', { name: 'Remove', exact: true });
    this.cancelRemove = page.getByRole('button', { name: 'Cancel' });
    this.removeError = page.locator('.remove').getByRole('alert');

    // Private notes and what was marked on the PDF (#186).
    this.notes = page.locator('#notes');
    this.noteField = this.notes.getByLabel('New note');
    this.addNoteButton = this.notes.getByRole('button', { name: 'Add note' });
    this.noNotes = this.notes.getByText('No notes yet.');
    this.notesError = this.notes.getByText('Your notes could not be loaded.');
    this.onPdfLine = this.notes.locator('.pdf-line');
    this.openReader = this.notes.getByRole('link', { name: 'Open the reader' });
    this.needsReview = page.locator('#needs-review');
    this.noteImages = this.notes.locator('app-annotation-text img');
    this.noteLinks = this.notes.locator('app-annotation-text a');

    // A private paper (#203) has no public page and is deleted, not just taken out of the library.
    this.privateBadge = page.locator('.badge-private');
    this.privateNote = page.getByText('Only you can see this paper. It has no public page.');
    this.deletePaper = page.getByRole('button', { name: 'Delete paper' });
    this.confirmDelete = page.getByRole('button', { name: 'Delete', exact: true });
  }

  async goto(id) {
    await this.page.goto(`/library/${id}`);
  }

  collectionBox(name) {
    return this.details.getByRole('checkbox', { name, exact: true });
  }

  async #collected(method, change) {
    const answered = this.page.waitForResponse((r) => r.request().method() === method && r.url().includes('/api/paper-library/collections/'));
    await change();
    return answered;
  }

  /** Ticks a collection and returns the API's answer to putting the paper in it. */
  joinCollection(name) {
    return this.#collected('PUT', () => this.collectionBox(name).check());
  }

  leaveCollection(name) {
    return this.#collected('DELETE', () => this.collectionBox(name).uncheck());
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
  /** One note or annotation of the list, found by the text it shows. */
  item(text) {
    return this.notes.locator('app-annotation-item').filter({ hasText: text });
  }

  /** The notes list has its own label; the "Needs review" list is another one. */
  noteItems() {
    return this.notes.getByRole('list', { name: 'Notes' }).locator('app-annotation-item');
  }

  reviewItems() {
    return this.needsReview.locator('app-annotation-item');
  }

  /** Runs a change and waits for the server's answer to the annotations call, so a reload right after cannot cut it off. */
  async #answered(method, change) {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === method && /\/api\/paper-library\/[a-z0-9-]+\/annotations(\/|$)/.test(res.url()),
    );
    await change();
    return answered;
  }

  async addNote(text) {
    await this.noteField.fill(text);
    return this.#answered('POST', () => this.addNoteButton.click());
  }

  async editNote(item, text) {
    await item.getByRole('button', { name: 'Edit' }).click();
    await item.getByLabel('Text').fill(text);
    return this.#answered('PATCH', () => item.getByRole('button', { name: 'Save' }).click());
  }

  /** Delete asks once more before it deletes. */
  async deleteNote(item) {
    await item.getByRole('button', { name: 'Delete' }).click();
    return this.#answered('DELETE', () => item.getByRole('button', { name: 'Delete' }).click());
  }

  keepAsNote(item) {
    return this.#answered('PATCH', () => item.getByRole('button', { name: 'Keep as a note' }).click());
  }

  /** True when a script typed into a note ran: it sets this flag if it does. */
  scriptRan() {
    return this.page.evaluate(() => 'xss' in window);
  }
}
