/**
 * What a reader does to share one annotation (#187): the controls inside an annotation of the notes list or of the
 * reader panel. Built from the locator of that annotation.
 */
export class AnnotationShareControls {
  constructor(item) {
    this.page = item.page();
    this.panel = item.locator('app-annotation-share');
    this.status = this.panel.locator('.status');
    this.start = this.panel.getByRole('button', { name: 'Share', exact: true });
    this.everyone = this.panel.getByLabel('Everyone who opens the paper');
    this.chosen = this.panel.getByLabel('Only the readers I name');
    this.names = this.panel.getByLabel('Their public profile names');
    this.groups = this.panel.getByLabel('Only my reading groups');
    this.noGroups = this.panel.getByText('None of your groups has this paper on its list.');
    this.send = this.panel.locator('form').getByRole('button', { name: 'Share', exact: true });
    this.cancel = this.panel.getByRole('button', { name: 'Cancel' });
    this.change = this.panel.getByRole('button', { name: 'Change who sees it' });
    this.stop = this.panel.getByRole('button', { name: 'Stop sharing' });
    this.refresh = this.panel.getByRole('button', { name: 'Update the shared copy' });
    this.outdated = this.panel.getByText('You changed this after sharing it');
    this.problem = this.panel.getByRole('alert');
  }

  /** Runs a change and waits for the server's answer to the share call. */
  async #answered(method, change) {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === method && /\/api\/paper-library\/[a-z0-9-]+\/annotations\/[0-9a-f-]+\/share$/.test(res.url()),
    );
    await change();
    return answered;
  }

  async shareWithEveryone() {
    await this.start.click();
    await this.everyone.check();
    return this.#answered('PUT', () => this.send.click());
  }

  /** Names are the part after /u/ of a profile link. */
  async shareWith(names) {
    await this.start.click();
    await this.chosen.check();
    await this.names.fill(names);
    return this.#answered('PUT', () => this.send.click());
  }

  /** Only the groups that have the paper on their list are offered; `names` are those to tick. */
  async shareWithGroups(names) {
    await this.start.click();
    await this.groups.check();
    for (const name of names) await this.panel.getByLabel(name, { exact: true }).check();
    return this.#answered('PUT', () => this.send.click());
  }

  async updateCopy() {
    return this.#answered('PUT', () => this.refresh.click());
  }

  async stopSharing() {
    return this.#answered('DELETE', () => this.stop.click());
  }
}
