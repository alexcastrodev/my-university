/** The discussion at the end of a concept page, and its composer with the `@` suggestions. */
export class ConceptDiscussionPage {
  constructor(page) {
    this.page = page;
    this.root = page.locator('app-concept-detail-layout app-concept-discussion');
    this.composer = this.root.locator('.discussion > .composer textarea[role="combobox"]');
    this.postButton = this.root.locator('.discussion > .composer button.send');
    this.suggestions = this.root.getByRole('listbox');
    this.options = this.suggestions.getByRole('option');
    this.posts = this.root.locator('.post-body');
  }

  async goto(path) {
    await this.page.goto(path);
    await this.composer.waitFor();
  }

  /** Types like a person does, so the editor sees each key and the caret. */
  async type(text) {
    await this.composer.click();
    await this.composer.pressSequentially(text);
  }

  async press(key) {
    await this.composer.press(key);
  }

  async post() {
    await this.postButton.click();
  }

  option(handle) {
    return this.options.filter({ hasText: `@${handle}` });
  }

  /** The mention link to a profile inside the posts. */
  mentionLink(handle) {
    return this.posts.locator(`a.mention[href="/u/${handle}"]`);
  }
}
