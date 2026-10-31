/** The "My PDF" panel on a paper's page: upload, replace, download, remove. */
export class PaperAttachmentPage {
  constructor(page) {
    this.page = page;

    this.panel = page.locator('.attachment');
    this.signIn = this.panel.getByRole('link', { name: /Sign in to keep your own PDF/ });
    this.fileInput = this.panel.locator('input[type="file"]');
    this.fileLink = this.panel.locator('.file-name');
    this.empty = this.panel.getByText('Keep your own copy of this paper. Only you can see it.');
    this.alert = this.panel.getByRole('alert');
    this.removeButton = this.panel.getByRole('button', { name: 'Remove PDF' });
    this.confirmRemove = this.panel.getByRole('button', { name: 'Yes, remove' });
    this.cancelRemove = this.panel.getByRole('button', { name: 'Cancel' });
  }

  async goto(id) {
    await this.page.goto(`/papers/${id}`);
  }

  /** Picks a file and waits for the upload request to settle, whatever the API answered. */
  async upload({ name, mimeType = 'application/pdf', buffer }) {
    const sent = this.page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/attachment'));
    await this.fileInput.setInputFiles({ name, mimeType, buffer });
    return sent;
  }

  async remove() {
    await this.removeButton.click();
    const sent = this.page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/attachment'));
    await this.confirmRemove.click();
    await sent;
  }
}
