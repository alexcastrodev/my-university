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
    // The header of every concept page: "Got it!" (read) and the module's bookmark sit side by side.
    this.gotItButton = page.locator('app-concept-actions .got-it-btn');
    this.bookmarkButton = page.locator('app-concept-actions .bookmark-btn');
    // "I finished the lab" lives in the Lab tab and is a different fact from having read the concept.
    this.finishedLabButton = page.locator('app-concept-lab-tab .lab-done-btn');
  }

  async goto(path) {
    await this.page.goto(path);
  }

  async openLab() {
    await this.labTab.click();
  }
}
