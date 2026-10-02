export class HeaderPage {
  constructor(page) {
    this.page = page;

    this.header      = page.getByRole('banner');
    this.brandLink   = page.getByRole('link', { name: 'My University Home' });
    this.examsLink   = page.getByRole('link', { name: 'Exams' });
    // Opens the platform-wide search palette (the header no longer holds the input itself).
    this.searchInput = page.getByRole('button', { name: 'Search courses' });
    this.searchDialog = page.getByRole('dialog', { name: 'Search the platform' });
    this.searchBox   = this.searchDialog.getByRole('combobox', { name: 'Search' });
    this.avatarBtn   = page.getByRole('button', { name: 'User account menu' });
  }
}
