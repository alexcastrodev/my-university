import { BASE_URL } from '../BaseTest.js';

/** One reading group (#190): who is in it, its papers, its board and the annotations shared into it. */
export class GroupPage {
  constructor(page) {
    this.page = page;

    this.title = page.getByRole('heading', { level: 1 });
    this.role = page.locator('.title-row .badge');
    this.missing = page.getByText('This group does not exist, or you are not in it.');
    this.tabs = page.getByRole('navigation', { name: 'Group sections' });
    this.problem = page.getByRole('alert');

    this.rename = page.getByRole('button', { name: 'Rename or describe' });
    this.delete = page.getByRole('button', { name: 'Delete group' });
    this.confirmDelete = page.getByRole('button', { name: 'Delete the group' });
    this.leave = page.getByRole('button', { name: 'Leave group' });
    this.confirmLeave = page.getByRole('button', { name: 'Leave the group' });

    // Papers
    this.papers = page.locator('app-group-papers [data-paper]');
    this.paperSearch = page.getByRole('searchbox', { name: 'Search the papers' });
    this.paperSearchButton = page.getByRole('button', { name: 'Search', exact: true });
    this.results = page.locator('[data-result]');

    // Board
    this.composer = page.getByLabel('Write to the group');
    this.about = page.getByLabel('About a paper (optional)');
    this.postButton = page.getByRole('button', { name: 'Post', exact: true });
    this.posts = page.locator('[data-post]');

    // Shared annotations
    this.annotations = page.locator('[data-annotation]');

    // Readers
    this.members = page.locator('[data-member]');
    this.inviteField = page.getByLabel('Their public profile name');
    this.inviteButton = page.getByRole('button', { name: 'Invite', exact: true });
    this.pending = page.locator('[data-pending]');
  }

  async goto(id, tab) {
    await this.page.goto(`${BASE_URL}/groups/${id}${tab ? `?tab=${tab}` : ''}`);
  }

  async openTab(name) {
    await this.tabs.getByRole('link', { name, exact: true }).click();
  }

  paper(title) {
    return this.papers.filter({ hasText: title });
  }

  result(title) {
    return this.results.filter({ hasText: title });
  }

  post(text) {
    return this.posts.filter({ hasText: text });
  }

  annotation(text) {
    return this.annotations.filter({ hasText: text });
  }

  member(name) {
    return this.members.filter({ hasText: name });
  }

  roleSelect(name) {
    return this.page.getByLabel(`Role of ${name}`);
  }

  /** Runs a change and waits for the server's answer to it. */
  async #answered(method, path, change) {
    const answered = this.page.waitForResponse((res) => res.request().method() === method && path.test(res.url()));
    await change();
    return answered;
  }

  /** Searches the catalog and adds the paper that is titled `title`. */
  async addPaper(query, title) {
    await this.paperSearch.fill(query);
    await this.paperSearchButton.click();
    return this.#answered('PUT', /\/api\/paper-groups\/[0-9a-f-]+\/papers\/[a-z0-9-]+/, () =>
      this.result(title).getByRole('button', { name: /^Add / }).click(),
    );
  }

  async removePaper(title) {
    return this.#answered('DELETE', /\/api\/paper-groups\/[0-9a-f-]+\/papers\/[a-z0-9-]+$/, () =>
      this.paper(title).getByRole('button', { name: /^Remove / }).click(),
    );
  }

  /** Writes on the board, about a paper when `title` is given. */
  async write(text, title) {
    await this.composer.fill(text);
    if (title) await this.about.selectOption({ label: title });
    return this.#answered('POST', /\/api\/paper-groups\/[0-9a-f-]+\/posts$/, () => this.postButton.click());
  }

  async removePost(text) {
    return this.#answered('DELETE', /\/api\/paper-groups\/[0-9a-f-]+\/posts\/[0-9a-f-]+$/, () =>
      this.post(text).getByRole('button', { name: /^Remove / }).click(),
    );
  }

  /** `user` is the part after /u/ of a public profile link, or the link itself. */
  async invite(user) {
    await this.inviteField.fill(user);
    return this.#answered('POST', /\/api\/paper-groups\/[0-9a-f-]+\/invitations$/, () => this.inviteButton.click());
  }

  async setRole(name, role) {
    return this.#answered('PATCH', /\/api\/paper-groups\/[0-9a-f-]+\/members\/[0-9a-f-]+$/, () => this.roleSelect(name).selectOption(role));
  }

  async removeMember(name) {
    return this.#answered('DELETE', /\/api\/paper-groups\/[0-9a-f-]+\/members\/[0-9a-f-]+$/, () =>
      this.member(name).getByRole('button', { name: 'Remove' }).click(),
    );
  }

  /** The button that takes a shared annotation out of the group: only its author, the owner and the moderators have it. */
  takeOutButton(text) {
    return this.annotation(text).getByRole('button', { name: /^Take the annotation of .* out of the group$/ });
  }

  async takeOut(text) {
    return this.#answered('DELETE', /\/api\/paper-groups\/[0-9a-f-]+\/annotations\/[0-9a-f-]+$/, () => this.takeOutButton(text).click());
  }

  async leaveGroup() {
    await this.leave.click();
    return this.#answered('POST', /\/api\/paper-groups\/[0-9a-f-]+\/leave$/, () => this.confirmLeave.click());
  }

  async deleteGroup() {
    await this.delete.click();
    return this.#answered('DELETE', /\/api\/paper-groups\/[0-9a-f-]+$/, () => this.confirmDelete.click());
  }
}
