import { BASE_URL } from '../BaseTest.js';

/** What a visitor sees at /u/<link>: the banner, its tabs, and the Library. */
export class PublicProfilePage {
  constructor(page) {
    this.page = page;

    this.name = page.getByRole('heading', { level: 1 });
    this.tabs = page.getByRole('navigation', { name: 'Profile sections' });
    this.overviewTab = this.tabs.getByRole('link', { name: 'Overview', exact: true });
    this.libraryTab = this.tabs.getByRole('link', { name: 'Library', exact: true });
    this.missing = page.getByText('This profile is private or does not exist.');

    this.emptyLibrary = page.getByText('No books here yet.');
    this.howToShowBooks = page.getByRole('link', { name: 'How to show your books' });
  }

  /** `tab` is the part after the link, e.g. `books`. */
  async goto(key, tab) {
    await this.page.goto(`${BASE_URL}/u/${key}${tab ? `/${tab}` : ''}`);
  }
}
