import { BASE_URL } from '../BaseTest.js';

/** The FAQ, whose #books section tells how to get a Library tab on a public profile. */
export class FaqPage {
  constructor(page) {
    this.page = page;

    this.booksHeading = page.getByRole('heading', { name: 'Show your books on your profile' });
    this.steps = page.locator('#books ol li');
    this.example = page.locator('#books pre');
    this.folderLink = page.getByRole('link', { name: 'See the books folder' });
  }

  async goto(hash = '') {
    await this.page.goto(`${BASE_URL}/faq${hash}`);
  }
}
