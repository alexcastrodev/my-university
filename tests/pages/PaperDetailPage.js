export class PaperDetailPage {
  constructor(page) {
    this.page = page;

    this.title = page.getByRole('heading', { level: 1 });
    this.authors = page.locator('.paper-authors');
    this.noAuthors = page.getByText('Authors not listed.');
    this.abstract = page.locator('.abstract');
    this.noAbstract = page.getByText('No abstract is available for this paper.');
    this.keywords = page.locator('.keywords .chip');
    this.noKeywords = page.getByText('No keywords listed.');
    this.dateUnknown = page.getByText('Date not listed');
    this.notFound = page.getByText('Paper not found.');
    this.backLink = page.getByRole('link', { name: /Papers/ }).first();
    this.discussion = page.locator('#discussion');
    this.discussionHeading = this.discussion.locator('.discussion-title');
    this.composer = this.discussion.locator('textarea');
    this.postButton = this.discussion.getByRole('button', { name: 'Post' });
    this.signIn = this.discussion.locator('a.signin');
    this.posts = this.discussion.locator('.post-body');

    this.library = page.locator('app-paper-library-panel');
    this.librarySignIn = this.library.getByRole('link', { name: 'Sign in to save this paper to your library' });
    this.libraryAdd = this.library.getByRole('button', { name: 'Add to my library' });
    this.libraryRemove = this.library.getByRole('button', { name: 'Remove from library' });
    this.libraryStatus = this.library.getByLabel('Status', { exact: true });
    this.libraryRating = this.library.getByLabel('Rating (1 to 5)');
    this.libraryCompleted = this.library.getByLabel('Finished on');
    this.libraryTagInput = this.library.getByLabel('New tag');
    this.libraryTagAdd = this.library.getByRole('button', { name: 'Add', exact: true });
    this.libraryTags = this.library.locator('.tag');
    this.libraryOpen = this.library.getByRole('link', { name: 'Open my library' });
    this.libraryError = this.library.getByRole('alert');
  }

  async goto(id) {
    await this.page.goto(`/papers/${id}`);
  }

  /** The value shown next to a label in the facts box (Type, Published, Venue, DOI...). */
  fact(label) {
    return this.page.locator('.fact').filter({ has: this.page.locator('dt', { hasText: label }) }).locator('dd');
  }

  author(name) {
    return this.authors.getByRole('link', { name, exact: true });
  }

  keyword(name) {
    return this.keywords.filter({ hasText: name });
  }

  async post(text) {
    await this.composer.fill(text);
    await this.postButton.click();
  }

  /**
   * Runs a change and waits for the server to answer it, so a navigation or reload right after
   * cannot cut the save off. Not for a change that is meant to fail.
   */
  async #saved(change) {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === 'PATCH' && /\/api\/paper-library\/\d+$/.test(res.url()),
    );
    await change();
    await answered;
  }

  /** Sets the reading status by its visible name ("To read", "Reading", "Read"). */
  async setStatus(label) {
    await this.#saved(() => this.libraryStatus.selectOption({ label }));
  }

  async rate(stars) {
    await this.#saved(() => this.libraryRating.selectOption(stars === null ? '' : String(stars)));
  }

  /** The finishing day, as `YYYY-MM-DD`. */
  async finishedOn(day) {
    await this.#saved(() => this.libraryCompleted.fill(day));
  }

  async addTag(text) {
    await this.libraryTagInput.fill(text);
    await this.#saved(() => this.libraryTagAdd.click());
  }

  libraryTag(text) {
    return this.libraryTags.filter({ hasText: text });
  }

  async removeTag(text) {
    await this.#saved(() => this.libraryTag(text).getByRole('button').click());
  }
}
