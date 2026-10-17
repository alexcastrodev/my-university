export class ConceptLabPage {
  constructor(page) {
    this.page = page;

    this.conceptTab = page.getByRole('tab', { name: /^(Concept|Conceito)$/ });
    this.labTab = page.getByRole('tab', { name: 'Lab' });
    this.openLabLink = page.locator('app-concept-lab-tab a.lab-cta');
    this.summary = page.locator('app-concept-lab-tab .lab-body');
    this.discussionHeading = page.locator('app-concept-lab-tab .discussion-title');
    this.signInLink = page.locator('app-concept-lab-tab a.signin');
    this.composer = page.locator('app-concept-lab-tab .lab-discussion textarea');
  }

  async goto(path) {
    await this.page.goto(path);
  }

  async openLab() {
    await this.labTab.click();
  }
}
