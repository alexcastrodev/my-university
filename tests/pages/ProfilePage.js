import { BASE_URL } from '../BaseTest.js';

/** The signed-in reader's own profile: the banner with its public link, and the panel where the custom link is set. */
export class ProfilePage {
  constructor(page) {
    this.page = page;

    this.banner = page.locator('app-profile-banner');
    this.publicLinkText = this.banner.locator('.public-link-text');
    this.copyButton = this.banner.getByRole('button', { name: /^(Copy link|Copied)$/ });
    this.openLink = this.banner.getByRole('link', { name: 'Open public profile' });

    this.editButton = page.getByRole('button', { name: 'Edit profile' });
    this.removeCustomLink = page.getByRole('button', { name: 'Remove custom link' });

    // The question that comes before the custom link is removed
    this.dialog = page.getByRole('dialog', { name: 'Remove custom link?' });
    this.confirm = this.dialog.getByRole('button', { name: 'Remove', exact: true });
    this.cancel = this.dialog.getByRole('button', { name: 'Cancel', exact: true });
  }

  async goto() {
    await this.page.goto(`${BASE_URL}/profile`);
  }

  async openEditor() {
    await this.editButton.click();
  }

  /** Confirms the question and waits for the server to take the custom link away. */
  async confirmRemoval() {
    const answered = this.page.waitForResponse((res) => res.request().method() === 'PUT' && res.url().endsWith('/api/auth/profile-slug'));
    await this.confirm.click();
    return answered;
  }
}
