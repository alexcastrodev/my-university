import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';
import { PaperLibraryPage } from './pages/PaperLibraryPage.js';

// Papers are seeded through the dev-only route and read through the pages. Every title carries a per-worker
// token, so a test only ever sees its own papers, and every test signs in as a reader of its own.
const token = `pl${Math.random().toString(36).slice(2, 8)}`;
const title = (n) => `Library paper ${token} ${n}`;

let api;
const ids = [];
let alpha;
let beta;
let gamma;

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE_URL });
  alpha = await seed({ title: title('alpha'), authors: [{ name: 'Ada Lovelace' }], publicationDate: '2021', type: 'journal-article' });
  beta = await seed({ title: title('beta'), authors: [{ name: 'Grace Hopper' }], publicationDate: '2020', type: 'preprint' });
  gamma = await seed({ title: title('gamma'), authors: [{ name: 'Alan Turing' }], publicationDate: '2019' });
});

test.afterAll(async () => {
  await Promise.all(ids.splice(0).map((id) => api.delete(`/api/papers/_test/${id}`)));
  await api.dispose();
});

async function seed(data) {
  const res = await api.post('/api/papers/_test', { data });
  expect(res.ok(), `POST /api/papers/_test (needs ENABLE_DEV_AUTH=1): ${await res.text()}`).toBeTruthy();
  const { paper } = await res.json();
  ids.push(paper.id);
  return paper.id;
}

/** Signs in as a reader no other test uses; the session cookie lands in the page's own context. */
async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

/** The page never needs to scroll sideways, whatever the viewport. */
async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Puts a paper in the library from its own page, the way a reader does. */
async function addFromPage(page, id) {
  const paper = new PaperDetailPage(page);
  await paper.goto(id);
  await paper.libraryAdd.click();
  await expect(paper.libraryStatus).toHaveValue('to-read');
  return paper;
}

test.describe('Paper library', () => {
  test.describe('signed out', () => {
    test('asks to sign in on the paper page, without an add button', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(alpha);
      await expect(paper.librarySignIn).toBeVisible();
      await expect(paper.libraryAdd).toHaveCount(0);
    });

    test('asks to sign in on the library page', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();
      await expect(library.signedOut).toBeVisible();
      await expect(library.cards).toHaveCount(0);
    });
  });

  test.describe('on the paper page', () => {
    test('adds the paper, keeps it after a reload and lists it in the library', async ({ page }) => {
      await signIn(page, 'Adder');
      const paper = await addFromPage(page, alpha);
      await expect(paper.libraryRemove).toBeVisible();

      await page.reload();
      await expect(paper.libraryStatus).toHaveValue('to-read');

      await paper.libraryOpen.click();
      const library = new PaperLibraryPage(page);
      await expect(library.cards).toHaveCount(1);
      await expect(library.card(title('alpha'))).toContainText('To read');
    });

    test('follows the reading progress: reading, then read with a finishing day', async ({ page }) => {
      await signIn(page, 'Progress');
      const paper = await addFromPage(page, alpha);

      await expect(paper.libraryCompleted).toHaveCount(0);
      await paper.setStatus('Reading');
      await expect(paper.libraryStatus).toHaveValue('reading');
      await expect(paper.libraryCompleted).toHaveCount(0);

      await paper.setStatus('Read');
      await expect(paper.libraryCompleted).toBeVisible();
      await paper.finishedOn('2024-02-29');
      await paper.rate(4);

      await page.reload();
      await expect(paper.libraryStatus).toHaveValue('read');
      await expect(paper.libraryCompleted).toHaveValue('2024-02-29');
      await expect(paper.libraryRating).toHaveValue('4');

      const library = new PaperLibraryPage(page);
      await library.goto();
      await expect(library.card(title('alpha'))).toContainText('Rating: 4/5');
      await expect(library.card(title('alpha'))).toContainText('Finished');
      await expect(library.card(title('alpha'))).toContainText('2024');
    });

    test('tags the paper, keeps the tags and removes one', async ({ page }) => {
      await signIn(page, 'Tagger');
      const paper = await addFromPage(page, alpha);

      await paper.addTag('  Thesis Chapter ');
      await expect(paper.libraryTag('thesis chapter')).toHaveCount(1);
      await expect(paper.libraryTagInput).toHaveValue('');
      await paper.addTag('survey');
      await expect(paper.libraryTags).toHaveCount(2);

      await page.reload();
      await expect(paper.libraryTags).toHaveCount(2);

      await paper.removeTag('survey');
      await expect(paper.libraryTags).toHaveCount(1);
      await expect(paper.libraryTag('thesis chapter')).toHaveCount(1);
    });

    test('removes the paper from the library and offers to add it again', async ({ page }) => {
      await signIn(page, 'Remover');
      const paper = await addFromPage(page, alpha);

      await paper.libraryRemove.click();
      await expect(paper.libraryAdd).toBeVisible();
      await expect(paper.libraryStatus).toHaveCount(0);

      const library = new PaperLibraryPage(page);
      await library.goto();
      await expect(library.empty).toBeVisible();

      // The paper itself is untouched.
      await paper.goto(alpha);
      await expect(paper.title).toHaveText(title('alpha'));
    });

    test('says so when a change cannot be saved, and shows what is stored', async ({ page }) => {
      await signIn(page, 'Failing');
      const paper = await addFromPage(page, alpha);

      await page.route(/\/api\/paper-library\/\d+$/, (route) => (route.request().method() === 'PATCH' ? route.abort() : route.continue()), { times: 1 });
      await paper.libraryStatus.selectOption({ label: 'Reading' });
      await expect(paper.libraryError).toContainText('Your change could not be saved.');
      await expect(paper.libraryStatus).toHaveValue('to-read');
    });
  });

  test.describe('the library page', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, 'Library');
      const paper = await addFromPage(page, alpha);
      await paper.setStatus('Read');
      await paper.rate(5);
      await paper.addTag('survey');
      await paper.addTag('nlp');

      await paper.goto(beta);
      await paper.libraryAdd.click();
      await paper.setStatus('Reading');
      await paper.addTag('survey');

      await paper.goto(gamma);
      await paper.libraryAdd.click();
      await expect(paper.libraryStatus).toHaveValue('to-read');
    });

    test('lists the papers, newest added first, with counts per status', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();

      await expect(library.heading).toBeVisible();
      await expect(library.cards).toHaveCount(3);
      await expect(library.cardTitles).toHaveText([title('gamma'), title('beta'), title('alpha')]);
      await expect(library.tab('All')).toContainText('3');
      await expect(library.tab('To read')).toContainText('1');
      await expect(library.tab('Reading')).toContainText('1');
      await expect(library.tab('Read')).toContainText('1');
    });

    test('filters by reading status', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();

      await library.tab('Reading').click();
      await expect(page).toHaveURL(/status=reading/);
      await expect(library.cardTitles).toHaveText([title('beta')]);
      await expect(library.tab('Reading')).toHaveAttribute('aria-current', 'page');

      await library.tab('All').click();
      await expect(library.cards).toHaveCount(3);
      await expect(page).not.toHaveURL(/status=/);
    });

    test('filters by tag, and the tag on a card is a link to that filter', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();

      await library.tagSelect.selectOption('survey');
      await expect(page).toHaveURL(/tag=survey/);
      await expect(library.cards).toHaveCount(2);
      await expect(library.activeFilters).toContainText('survey');

      await library.clearFilters.click();
      await expect(library.cards).toHaveCount(3);

      await library.card(title('alpha')).getByRole('link', { name: 'nlp' }).click();
      await expect(page).toHaveURL(/tag=nlp/);
      await expect(library.cardTitles).toHaveText([title('alpha')]);
    });

    test('searches the library and says when nothing matches', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();

      await library.search('Hopper');
      await expect(library.cardTitles).toHaveText([title('beta')]);

      await library.search('nobody wrote this');
      await expect(library.noMatches).toBeVisible();
      await library.clearFilters.click();
      await expect(library.cards).toHaveCount(3);
    });

    test('sorts by title and by rating', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();

      await library.sortSelect.selectOption('title');
      await expect(page).toHaveURL(/sort=title/);
      await expect(library.cardTitles).toHaveText([title('alpha'), title('beta'), title('gamma')]);

      await library.sortSelect.selectOption('rating');
      await expect(page).toHaveURL(/sort=rating/);
      await expect(library.cardTitles.first()).toHaveText(title('alpha'));
    });

    test('opens a paper from its card', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.open(title('beta'));

      const paper = new PaperDetailPage(page);
      await expect(paper.title).toHaveText(title('beta'));
      await expect(paper.libraryStatus).toHaveValue('reading');
    });

    test('shows an error with a way to try again', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await page.route(/\/api\/paper-library(\?|$)/, (route) => route.abort(), { times: 1 });
      await library.goto();

      await expect(library.errorMessage).toBeVisible();
      await library.retryButton.click();
      await expect(library.cards).toHaveCount(3);
    });

    test('fits the screen', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();
      await expect(library.cards).toHaveCount(3);
      await expectNoHorizontalScroll(page);

      const paper = new PaperDetailPage(page);
      await paper.goto(alpha);
      await expect(paper.libraryStatus).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });

  test('keeps one reader\'s library out of sight of another', async ({ page, browser }) => {
    await signIn(page, 'Owner');
    await addFromPage(page, alpha);

    const other = await browser.newContext({ baseURL: BASE_URL });
    const otherPage = await other.newPage();
    await signIn(otherPage, 'Stranger');

    const library = new PaperLibraryPage(otherPage);
    await library.goto();
    await expect(library.empty).toBeVisible();

    const paper = new PaperDetailPage(otherPage);
    await paper.goto(alpha);
    await expect(paper.libraryAdd).toBeVisible();
    await other.close();
  });
});
