export class HeaderPage {
  constructor(page) {
    this.page = page;

    this.header      = page.getByRole('banner');
    this.brandLink   = page.getByRole('link', { name: 'My University Home' });
    this.examsLink   = page.getByRole('link', { name: 'Exams' });
    this.searchInput = page.getByRole('searchbox', { name: 'Search courses' });
    this.avatarBtn   = page.getByRole('button', { name: 'User account menu' });
  }
}
