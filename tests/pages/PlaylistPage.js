export class PlaylistPage {
  constructor(page) {
    this.page = page;

    this.aside         = page.getByRole('complementary', { name: 'Course playlist' });
    this.searchInput   = page.getByRole('searchbox', { name: 'Search within playlist' });
    this.modulesList   = page.locator('.modules-list');
    this.footer        = page.locator('.playlist-footer');
    this.footerDuration = page.locator('.footer-duration');
  }

  moduleHeader(title) {
    return this.page.getByRole('button', { name: new RegExp(title, 'i') });
  }

  lessonButton(title) {
    return this.page.getByRole('button', { name: new RegExp(title, 'i') }).filter({ hasText: title });
  }

  async overflowY() {
    await this.modulesList.waitFor();
    return this.page.evaluate(() => {
      const el = document.querySelector('.modules-list');
      return el ? getComputedStyle(el).overflowY : null;
    });
  }

  async toggleModule(title) {
    await this.moduleHeader(title).click();
  }
}
