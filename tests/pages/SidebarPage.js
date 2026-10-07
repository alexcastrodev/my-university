export class SidebarPage {
  constructor(page) {
    this.page = page;

    // The left rail that replaced the top header; hidden on phones (the bottom tab bar takes over).
    this.sidebar     = page.getByRole('complementary');
    this.brandLink   = page.getByRole('link', { name: 'My University Home' });
    this.examsLink   = page.getByRole('link', { name: 'Exams' });
    // Opens the platform-wide search palette (the sidebar only holds the trigger button).
    this.searchInput = page.getByRole('button', { name: 'Search courses' });
    this.searchDialog = page.getByRole('dialog', { name: 'Search the platform' });
    this.searchBox   = this.searchDialog.getByRole('combobox', { name: 'Search' });
    this.avatarBtn   = page.getByRole('button', { name: 'User account menu' });
  }
}
