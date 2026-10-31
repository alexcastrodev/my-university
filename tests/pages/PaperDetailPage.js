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
}
