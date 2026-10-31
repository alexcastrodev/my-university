export class PaperAddPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading', { level: 1, name: 'Add a paper' });
    this.backLink = page.getByRole('link', { name: /Back to my library/ });
    this.signInPrompt = page.locator('.state');
    this.signInLink = this.signInPrompt.getByRole('link', { name: 'Sign in' });

    this.doiInput = page.locator('#paper-doi');
    this.lookupButton = page.getByRole('button', { name: /^Look(ing)? up/ });
    this.problem = page.locator('.problem');
    this.found = page.locator('.found');
    this.foundTitle = page.locator('.found-title');
    this.addButton = page.getByRole('button', { name: 'Add to my library' });
    this.matchNotice = page.locator('.notice-match');
    this.openLink = this.matchNotice.getByRole('link', { name: 'Open it' });

    this.manualToggle = page.getByRole('button', { name: /^(Show|Hide) the form$/ });
    this.form = page.locator('#manual-form');
    this.titleField = this.form.getByLabel('Title');
    this.authorsField = this.form.getByLabel('Authors');
    this.dateField = this.form.getByLabel('Publication date');
    this.typeField = this.form.getByLabel('Type');
    this.venueField = this.form.getByLabel('Venue');
    this.doiField = this.form.getByLabel('DOI');
    this.urlField = this.form.getByLabel('Link');
    this.keywordsField = this.form.getByLabel('Keywords');
    this.abstractField = this.form.getByLabel('Abstract');
    this.saveButton = this.form.getByRole('button', { name: 'Add paper' });
  }

  async goto() {
    await this.page.goto('/library/add');
  }

  async lookup(doi) {
    await this.doiInput.fill(doi);
    await this.lookupButton.click();
  }

  async openManual() {
    if ((await this.manualToggle.textContent())?.includes('Show')) await this.manualToggle.click();
  }

  async fillManual({ title, authors, date, venue, doi, keywords, abstract }) {
    await this.openManual();
    await this.titleField.fill(title);
    if (authors) await this.authorsField.fill(authors);
    if (date) await this.dateField.fill(date);
    if (venue) await this.venueField.fill(venue);
    if (doi) await this.doiField.fill(doi);
    if (keywords) await this.keywordsField.fill(keywords);
    if (abstract) await this.abstractField.fill(abstract);
  }
}
