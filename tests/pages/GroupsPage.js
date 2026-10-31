import { BASE_URL } from '../BaseTest.js';

/** The list of the reader's reading groups (#190): invitations waiting, the groups, and the form that starts one. */
export class GroupsPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading', { level: 1, name: 'Reading groups' });
    this.signedOut = page.getByText('Sign in to see your reading groups.');
    this.cards = page.locator('[data-group]');
    this.invitations = page.locator('[data-invitation]');
    this.empty = page.getByText('You are not in any group yet. Start one below, or accept an invitation.');
    this.nameField = page.getByLabel('Name', { exact: true });
    this.descriptionField = page.getByLabel('What the group studies (optional)');
    this.createButton = page.getByRole('button', { name: 'Create group' });
    this.problem = page.getByRole('alert');
  }

  async goto() {
    await this.page.goto(`${BASE_URL}/groups`);
    await this.heading.waitFor();
  }

  card(name) {
    return this.cards.filter({ hasText: name });
  }

  invitation(groupName) {
    return this.invitations.filter({ hasText: groupName });
  }

  /** Starts a group and waits for the server's answer; the page then moves to the new group. */
  async create(name, description) {
    await this.nameField.fill(name);
    if (description) await this.descriptionField.fill(description);
    const answered = this.page.waitForResponse((res) => res.request().method() === 'POST' && /\/api\/paper-groups$/.test(res.url()));
    await this.createButton.click();
    return answered;
  }

  async accept(groupName) {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === 'POST' && /\/api\/paper-groups\/invitations\/[0-9a-f-]+\/accept$/.test(res.url()),
    );
    await this.invitation(groupName).getByRole('button', { name: 'Accept' }).click();
    return answered;
  }

  async decline(groupName) {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === 'DELETE' && /\/api\/paper-groups\/invitations\/[0-9a-f-]+$/.test(res.url()),
    );
    await this.invitation(groupName).getByRole('button', { name: 'Decline' }).click();
    return answered;
  }
}
