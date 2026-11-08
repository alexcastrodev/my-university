export class BookmarksPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading', { name: 'Bookmarks', level: 1 });
    this.rows = page.getByTestId('bookmark-row');
    this.empty = page.getByTestId('bookmarks-empty');
    this.course = page.getByTestId('bookmark-course');
    this.loginPrompt = page.getByText('Log in to keep bookmarks.');

    // The rail lists the three most recent; its nav link stays reachable when the rail is collapsed.
    this.sidebarLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Bookmarks', exact: true });
    this.sidebarItems = page.locator('aside.sidebar .bookmarks-item');
    // On phones there is no sidebar: the home screen carries the way in.
    this.mobileShortcut = page.locator('app-mobile-home a.shortcut[href="/bookmarks"]');
  }

  async goto() {
    await this.page.goto('/bookmarks');
  }

  /** The row of one module, found by the area it shows ("Java Testing", "Spring"). */
  row(area) {
    return this.rows.filter({ hasText: area });
  }

  rowLink(area) {
    return this.row(area).getByRole('link');
  }

  removeButton(area) {
    return this.row(area).getByRole('button', { name: 'Remove bookmark' });
  }
}
