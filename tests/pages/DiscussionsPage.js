export class DiscussionsPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading', { name: 'Discussions' });
    this.tabs = page.getByRole('tab');
    this.allTab = page.getByRole('tab', { name: 'All' });
    this.mineTab = page.getByRole('tab', { name: 'Mine' });
    this.participatedTab = page.getByRole('tab', { name: 'Participated' });
    this.loginLink = page.locator('.center-message a[href="/login"]');
    this.items = page.locator('a.item');
    this.emptyOrList = page.locator('ul.feed, p.empty');
  }

  async goto() {
    await this.page.goto('/discussions');
  }

  async openTab(tab) {
    await tab.click();
  }

  firstItemHref() {
    return this.items.first().getAttribute('href');
  }
}
