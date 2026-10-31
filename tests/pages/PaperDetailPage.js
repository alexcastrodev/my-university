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
    // Where the paper stands, in plain words, next to the title.
    this.stage = page.locator('.stage-note');
    this.stageTitle = this.stage.locator('.stage-title');
    this.stageText = this.stage.locator('.stage-text');
    this.discussion = page.locator('#discussion');
    this.discussionHeading = this.discussion.locator('.discussion-title');
    this.composer = this.discussion.locator('textarea');
    this.postButton = this.discussion.getByRole('button', { name: 'Post' });
    this.signIn = this.discussion.locator('a.signin');
    this.posts = this.discussion.locator('.post-body');

    // The public page only has the one button; what a reader keeps about a paper lives on the library page.
    this.library = page.locator('app-paper-library-button');
    this.librarySignIn = this.library.getByRole('link', { name: 'Sign in to save this paper to your library' });
    this.libraryAdd = this.library.getByRole('button', { name: 'Add to my library' });
    this.libraryRemove = this.library.getByRole('button', { name: 'Remove from library' });
    this.libraryIn = this.library.locator('.in-library');
    this.libraryOpen = this.library.getByRole('link', { name: 'Open in my library' });
    this.libraryControls = this.library.locator('select, input');
    this.libraryError = this.library.getByRole('alert');

    this.analysis = page.locator('#analysis');
    this.analysisNote = this.analysis.locator('.analysis-note');
    this.analysisCredit = this.analysis.locator('.analysis-credit');
    this.analysisTitles = this.analysis.locator('.analysis-section-title');
    this.analysisBodies = this.analysis.locator('.section-body');
    // The same page in the other language, for search engines.
    this.alternates = page.locator('link[rel="alternate"][hreflang]');
  }

  /** `query` is for a page that changed since it was last rendered: the server keeps a rendered page per URL for a few minutes. */
  async goto(id, query = '') {
    await this.page.goto(`/papers/${id}${query}`);
  }

  /** The Portuguese version of the same paper. */
  async gotoPortuguese(id) {
    await this.page.goto(`/pt-BR/papers/${id}`);
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

  /** One section of the Research Analysis, found by its heading ("Overview", "Critical Analysis"...). */
  analysisSection(title) {
    return this.analysis.locator('.analysis-section').filter({ has: this.page.getByRole('heading', { level: 3, name: title, exact: true }) });
  }

  async post(text) {
    await this.composer.fill(text);
    await this.postButton.click();
  }
}
