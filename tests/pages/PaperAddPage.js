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

    // The panel for a paper that is not in the catalog (#203), and the form that follows a chosen file.
    this.drop = page.locator('app-paper-private-drop');
    this.dropZone = this.drop.locator('.drop-zone');
    this.fileInput = this.drop.locator('input[type="file"]');
    this.pdfTitleInput = this.drop.getByLabel('Title', { exact: true });
    this.pdfDoiInput = this.drop.getByLabel('DOI (optional)');
    this.pdfAddButton = this.drop.getByRole('button', { name: 'Add to my library' });
    this.pdfCancelButton = this.drop.getByRole('button', { name: 'Cancel' });
    this.dropError = this.drop.getByRole('alert');
    this.dropDone = this.drop.locator('.drop-done');
    this.dropOpenLink = this.drop.getByRole('link', { name: 'Open' });

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

  /** Sends the PDF form and waits for the API to answer it, whatever it said. */
  async submitPdf() {
    const sent = this.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/paper-library/private'));
    await this.pdfAddButton.click();
    return sent;
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
