import { PaperLayout } from './PaperLayout.js';

export class PaperDetailPage {
  constructor(page) {
    this.page = page;

    // Authors, facts, keywords and the library button sit in the aside, beside the body on a wide screen.
    this.layout = new PaperLayout(page);
    this.aside = this.layout.aside;
    this.body = this.layout.body;
    this.sideAuthors = this.aside.locator('.paper-authors');
    this.sideFacts = this.aside.locator('.facts');
    this.sideKeywords = this.aside.locator('.keywords .chip');
    this.sideLibrary = this.aside.locator('app-paper-library-button');

    this.title = page.getByRole('heading', { level: 1 });
    // The title the authors published, under our translation of it.
    this.originalTitle = page.locator('.original-title');
    this.authors = page.locator('.paper-authors');
    this.noAuthors = page.getByText('Authors not listed.');
    this.abstract = page.locator('.abstract');
    this.noAbstract = page.getByText('No abstract is available for this paper.');
    // Shown only on the Portuguese page of a paper whose abstract we translated.
    this.abstractNote = page.locator('.abstract-note');
    this.area = page.locator('.fact a[href*="area="]');
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

    // What readers shared about the paper (#187): shown only when there is something to show.
    this.shared = page.locator('#shared-annotations');
    this.sharedItems = this.shared.locator('li.item');

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

  /**
   * Opens the paper and waits for the server's answer about what readers shared, so "nothing shared" is what the
   * server said and not a page that has not asked yet.
   */
  async gotoWithShares(id) {
    const answered = this.page.waitForResponse((res) => res.url().endsWith(`/api/papers/${id}/shared-annotations`));
    await this.goto(id);
    await answered;
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

  /** One shared annotation, found by the text it shows. */
  sharedItem(text) {
    return this.sharedItems.filter({ hasText: text });
  }
}
