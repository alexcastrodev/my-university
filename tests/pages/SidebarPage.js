export class SidebarPage {
  constructor(page) {
    this.page = page;

    // The left rail that replaced the top header; hidden on phones (the bottom tab bar takes over).
    this.sidebar     = page.locator('aside.sidebar');
    this.brandLink   = page.getByRole('link', { name: 'My University Home' });
    this.tracksLink  = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Tracks' });
    // Papers is the public catalog; "My library" is the signed-in reader's own shelf, so it sits next to it.
    this.papersLink  = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Papers', exact: true });
    this.libraryLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My library', exact: true });
    // On phones the sidebar is gone and this tab bar takes over.
    this.bottomNav   = page.getByRole('navigation', { name: 'Primary' });
    // Opens the platform-wide search palette (the sidebar only holds the trigger button).
    this.searchInput = page.getByRole('button', { name: 'Search courses' });
    this.searchDialog = page.getByRole('dialog', { name: 'Search the platform' });
    this.searchBox   = this.searchDialog.getByRole('combobox', { name: 'Search' });
    this.avatarBtn   = page.getByRole('button', { name: 'User account menu' });
  }
}
