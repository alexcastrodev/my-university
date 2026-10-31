import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';
import { PaperLibraryPage } from './pages/PaperLibraryPage.js';
import { SidebarPage } from './pages/SidebarPage.js';

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

/** Puts a paper in the signed-in reader's library (and sets what they keep about it) through the API. */
async function addToLibrary(page, id, change) {
  const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: id } });
  expect(added.ok(), `POST /api/paper-library: ${await added.text()}`).toBeTruthy();
  if (!change) return;
  const updated = await page.request.patch(`${BASE_URL}/api/paper-library/${id}`, { data: change });
  expect(updated.ok(), `PATCH /api/paper-library/${id}: ${await updated.text()}`).toBeTruthy();
}

test.describe('Paper library', () => {
  // The phone has no sidebar (a tab bar takes over), so the menu is only checked on the desktop projects.
  test.describe('menu', () => {
    test.skip(({ isMobile }) => isMobile, 'the sidebar does not exist on phones');

    test('a signed-out visitor sees Papers but no library entry', async ({ page }) => {
      const sidebar = new SidebarPage(page);
      await page.goto('/papers');
      await expect(sidebar.papersLink).toBeVisible();
      await expect(sidebar.libraryLink).toHaveCount(0);
    });

    test('Papers stays the public catalog and My library is its own entry', async ({ page }) => {
      await signIn(page, 'Navigator');
      const sidebar = new SidebarPage(page);
      await page.goto('/papers');
      await expect(sidebar.papersLink).toHaveClass(/active/);
      await expect(sidebar.libraryLink).not.toHaveClass(/active/);

      await sidebar.libraryLink.click();
      await expect(page).toHaveURL(/\/library$/);
      await expect(new PaperLibraryPage(page).heading).toBeVisible();
      await expect(sidebar.libraryLink).toHaveClass(/active/);
      await expect(sidebar.papersLink).not.toHaveClass(/active/);

      await sidebar.papersLink.click();
      await expect(page).toHaveURL(/\/papers$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Papers' })).toBeVisible();
    });

    test('a paper page still counts as Papers, not as the library', async ({ page }) => {
      await signIn(page, 'Reader');
      const sidebar = new SidebarPage(page);
      await new PaperDetailPage(page).goto(alpha);
      await expect(sidebar.papersLink).toHaveClass(/active/);
      await expect(sidebar.libraryLink).not.toHaveClass(/active/);
    });
  });

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

    test('asks to sign in on a library entry', async ({ page }) => {
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);
      await expect(entry.signedOut).toBeVisible();
      await expect(entry.title).toHaveCount(0);
    });
  });

  test.describe('on the paper page', () => {
    test('is one button: adding keeps no status, rating or tags on the public page', async ({ page }) => {
      await signIn(page, 'Adder');
      const paper = new PaperDetailPage(page);
      await paper.goto(alpha);
      await expect(paper.libraryAdd).toBeVisible();

      await paper.libraryAdd.click();
      await expect(paper.libraryIn).toBeVisible();
      await expect(paper.libraryControls).toHaveCount(0);

      await page.reload();
      await expect(paper.libraryIn).toBeVisible();
      await expect(paper.libraryAdd).toHaveCount(0);
    });

    test('leads from the paper to its library page, which has no discussion', async ({ page }) => {
      await signIn(page, 'Opener');
      await addToLibrary(page, alpha);
      const paper = new PaperDetailPage(page);
      await paper.goto(alpha);
      await expect(paper.discussion).toBeVisible();

      await paper.libraryOpen.click();
      const entry = new PaperLibraryEntryPage(page);
      await expect(page).toHaveURL(new RegExp(`/library/${alpha}$`));
      await expect(entry.title).toHaveText(title('alpha'));
      await expect(entry.discussion).toHaveCount(0);

      await entry.publicLink.click();
      await expect(page).toHaveURL(new RegExp(`/papers/${alpha}$`));
      await expect(paper.discussion).toBeVisible();
    });

    test('removes the paper from the library and offers to add it again', async ({ page }) => {
      await signIn(page, 'Remover');
      await addToLibrary(page, alpha);
      const paper = new PaperDetailPage(page);
      await paper.goto(alpha);

      await paper.libraryRemove.click();
      await expect(paper.libraryAdd).toBeVisible();

      const library = new PaperLibraryPage(page);
      await library.goto();
      await expect(library.empty).toBeVisible();

      // The paper itself is untouched.
      await paper.goto(alpha);
      await expect(paper.title).toHaveText(title('alpha'));
    });

    test('says so when the paper cannot be added, and offers the button again', async ({ page }) => {
      await signIn(page, 'Failing');
      const paper = new PaperDetailPage(page);
      await paper.goto(alpha);

      await page.route(/\/api\/paper-library$/, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()), { times: 1 });
      await paper.libraryAdd.click();
      await expect(paper.libraryError).toContainText('Your change could not be saved.');
      await expect(paper.libraryAdd).toBeVisible();
    });
  });

  test.describe('the library entry page', () => {
    test('shows the paper and what the reader keeps about it, with no discussion', async ({ page }) => {
      await signIn(page, 'Reader');
      await addToLibrary(page, alpha, { status: 'reading', rating: 3, tags: ['survey'] });
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);

      await expect(entry.title).toHaveText(title('alpha'));
      await expect(entry.authors).toContainText('Ada Lovelace');
      await expect(entry.status).toHaveValue('reading');
      await expect(entry.rating).toHaveValue('3');
      await expect(entry.tag('survey')).toHaveCount(1);
      await expect(entry.discussion).toHaveCount(0);
      await expect(entry.publicLink).toHaveAttribute('href', `/papers/${alpha}`);
    });

    test('explains where the paper stands, as the public page does', async ({ page }) => {
      await signIn(page, 'Careful');
      await addToLibrary(page, beta);
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(beta);

      await expect(entry.stageTitle).toContainText('Preprint: not reviewed yet');
      await expect(entry.stageText).toContainText('treat it as work in progress');
    });

    test('follows the reading progress: reading, then read with a finishing day', async ({ page }) => {
      await signIn(page, 'Progress');
      await addToLibrary(page, alpha);
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);

      await expect(entry.status).toHaveValue('to-read');
      await expect(entry.completed).toHaveCount(0);
      await entry.setStatus('Reading');
      await expect(entry.completed).toHaveCount(0);

      await entry.setStatus('Read');
      await expect(entry.completed).toBeVisible();
      await entry.finishedOn('2024-02-29');
      await entry.rate(4);

      await page.reload();
      await expect(entry.status).toHaveValue('read');
      await expect(entry.completed).toHaveValue('2024-02-29');
      await expect(entry.rating).toHaveValue('4');

      const library = new PaperLibraryPage(page);
      await library.goto();
      await expect(library.card(title('alpha'))).toContainText('Rating: 4/5');
      await expect(library.card(title('alpha'))).toContainText('Finished');
      await expect(library.card(title('alpha'))).toContainText('2024');
    });

    test('tags the paper, keeps the tags and removes one', async ({ page }) => {
      await signIn(page, 'Tagger');
      await addToLibrary(page, alpha);
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);

      await entry.addTag('  Thesis Chapter ');
      await expect(entry.tag('thesis chapter')).toHaveCount(1);
      await expect(entry.tagInput).toHaveValue('');
      await entry.addTag('survey');
      await expect(entry.tags).toHaveCount(2);

      await page.reload();
      await expect(entry.tags).toHaveCount(2);

      await entry.removeTag('survey');
      await expect(entry.tags).toHaveCount(1);
      await expect(entry.tag('thesis chapter')).toHaveCount(1);
    });

    test('says so when a change cannot be saved, and shows what is stored', async ({ page }) => {
      await signIn(page, 'Failing');
      await addToLibrary(page, alpha);
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);
      await expect(entry.status).toHaveValue('to-read');

      await page.route(/\/api\/paper-library\/\d+$/, (route) => (route.request().method() === 'PATCH' ? route.abort() : route.continue()), { times: 1 });
      await entry.status.selectOption({ label: 'Reading' });
      await expect(entry.saveError).toContainText('Your change could not be saved.');
      await expect(entry.status).toHaveValue('to-read');
    });

    test('asks before removing, and keeps the paper when the reader cancels', async ({ page }) => {
      await signIn(page, 'Remover');
      await addToLibrary(page, alpha, { rating: 5 });
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);

      await entry.remove.click();
      await entry.cancelRemove.click();
      await expect(entry.remove).toBeVisible();
      await expect(entry.rating).toHaveValue('5');

      await entry.remove.click();
      await entry.confirmRemove.click();
      await expect(page).toHaveURL(/\/library$/);
      const library = new PaperLibraryPage(page);
      await expect(library.empty).toBeVisible();
    });

    test('says so for a paper that is not in the library', async ({ page }) => {
      await signIn(page, 'Newcomer');
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);
      await expect(entry.missing).toBeVisible();
      await expect(entry.status).toHaveCount(0);
    });

    test('says so for an address that is not a paper', async ({ page }) => {
      await signIn(page, 'Lost');
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto('not-a-paper');
      await expect(entry.missing).toBeVisible();
    });

    test('shows an error with a way to try again', async ({ page }) => {
      await signIn(page, 'Offline');
      await addToLibrary(page, alpha);
      const entry = new PaperLibraryEntryPage(page);
      await page.route(new RegExp(`/api/paper-library/${alpha}$`), (route) => route.abort(), { times: 1 });
      await entry.goto(alpha);

      await expect(entry.errorMessage).toBeVisible();
      await entry.retryButton.click();
      await expect(entry.title).toHaveText(title('alpha'));
    });

    test('fits the screen', async ({ page }) => {
      await signIn(page, 'Phone');
      await addToLibrary(page, alpha, { status: 'read', rating: 5, tags: ['survey', 'nlp'] });
      const entry = new PaperLibraryEntryPage(page);
      await entry.goto(alpha);
      await expect(entry.status).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });

  test.describe('the library page', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, 'Library');
      await addToLibrary(page, alpha, { status: 'read', rating: 5, tags: ['survey', 'nlp'] });
      await addToLibrary(page, beta, { status: 'reading', tags: ['survey'] });
      await addToLibrary(page, gamma);
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

    test('keeps saying where each paper stands: a preprint stays a preprint in the library', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();

      await expect(library.cardStage(title('beta'))).toHaveText('Preprint: not reviewed yet');
      await expect(library.cardStage(title('alpha'))).toHaveText('Published');
      await expect(library.cardStage(title('gamma'))).toHaveText('Status unknown');
    });

    test('opens the library entry of a paper from its card', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.open(title('beta'));

      const entry = new PaperLibraryEntryPage(page);
      await expect(page).toHaveURL(new RegExp(`/library/${beta}$`));
      await expect(entry.title).toHaveText(title('beta'));
      await expect(entry.status).toHaveValue('reading');
      await expect(entry.discussion).toHaveCount(0);
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
    });
  });

  test('keeps one reader\'s library out of sight of another', async ({ page, browser }) => {
    await signIn(page, 'Owner');
    await addToLibrary(page, alpha, { rating: 5 });

    const other = await browser.newContext({ baseURL: BASE_URL });
    const otherPage = await other.newPage();
    await signIn(otherPage, 'Stranger');

    const library = new PaperLibraryPage(otherPage);
    await library.goto();
    await expect(library.empty).toBeVisible();

    const entry = new PaperLibraryEntryPage(otherPage);
    await entry.goto(alpha);
    await expect(entry.missing).toBeVisible();

    const paper = new PaperDetailPage(otherPage);
    await paper.goto(alpha);
    await expect(paper.libraryAdd).toBeVisible();
    await other.close();
  });
});
