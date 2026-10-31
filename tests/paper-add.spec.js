import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperAddPage } from './pages/PaperAddPage.js';
import { PapersListPage } from './pages/PapersListPage.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';

// The browser talks to the real API for everything except the Crossref lookup: the provider is the one thing
// a test must not call, so the lookup answers are stubbed at the browser. The server side of the lookup,
// import and creation is covered against a stub Crossref in backend/spec/papers-import.spec.ts.
const token = `pa${Math.random().toString(36).slice(2, 8)}`;
const ids = [];
let api;

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE_URL });
});
test.afterAll(async () => {
  await Promise.all(ids.splice(0).map((id) => api.delete(`/api/papers/_test/${id}`)));
  await api.dispose();
});

async function signIn(page, name = 'Adder') {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

async function seed(data) {
  const res = await api.post('/api/papers/_test', { data });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { paper } = await res.json();
  ids.push(paper.id);
  return paper;
}

const candidate = {
  title: `Stubbed paper ${token}`,
  authors: [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }],
  publicationDate: '2021-03',
  venue: 'Journal of Stubs',
  type: 'journal-article',
  abstract: 'What the provider says about it.',
  doi: '10.5555/stubbed',
};
const preview = (over = {}) => ({
  doi: '10.5555/stubbed',
  source: { name: 'crossref', retrievedAt: new Date().toISOString() },
  candidate,
  match: null,
  conflicts: [],
  ...over,
});
const reply = (status, body) => (route) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Add a paper', () => {
  test('asks a signed-out reader to sign in, and offers no form', async ({ page }) => {
    const add = new PaperAddPage(page);
    await add.goto();
    await expect(add.heading).toBeVisible();
    await expect(add.signInLink).toBeVisible();
    await expect(add.doiInput).toHaveCount(0);
    await expect(add.manualToggle).toHaveCount(0);
  });

  test('is reached from the catalog', async ({ page }) => {
    const list = new PapersListPage(page);
    await list.goto();
    await list.addPaperLink.click();
    await expect(page).toHaveURL(/\/papers\/new$/);
    await expect(new PaperAddPage(page).heading).toBeVisible();
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    test('previews what the DOI is, then adds it and opens the paper', async ({ page }) => {
      const real = await seed({ title: `Opened after adding ${token}`, doi: `10.5555/${token}.opened` });
      let lookedUp;
      let imported;
      await page.route('**/api/papers/import/preview', (route) => {
        lookedUp = route.request().postDataJSON();
        return reply(200, preview())(route);
      });
      await page.route(/\/api\/papers\/import$/, (route) => {
        imported = route.request().postDataJSON();
        return reply(201, { paper: { ...real }, created: true, conflicts: [] })(route);
      });

      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('  https://doi.org/10.5555/STUBBED ');
      await expect(add.foundTitle).toHaveText(candidate.title);
      await expect(add.found).toContainText('Ada Lovelace; Grace Hopper');
      await expect(add.found).toContainText('March 2021');
      await expect(add.found).toContainText('Journal of Stubs');
      await expect(add.found).toContainText('Journal article');
      await expect(add.found).toContainText('What the provider says about it.');
      await expect(add.found).toContainText('Crossref');
      // Nothing is added by looking.
      expect(imported).toBeUndefined();
      expect(lookedUp).toEqual({ doi: 'https://doi.org/10.5555/STUBBED' });

      await add.addButton.click();
      await expect(page).toHaveURL(new RegExp(`/papers/${real.id}$`));
      await expect(new PaperDetailPage(page).title).toHaveText(`Opened after adding ${token}`);
      // The server fetches the metadata itself: the browser sends the DOI and nothing else.
      expect(imported).toEqual({ doi: '10.5555/stubbed' });
    });

    test('says the paper is already in the catalog and links to it, with nothing to add', async ({ page }) => {
      const existing = await seed({ title: `Already here ${token}`, doi: `10.5555/${token}.here` });
      await page.route('**/api/papers/import/preview', reply(200, preview({ match: existing, conflicts: [{ field: 'title', current: 'a', incoming: 'b', resolution: 'kept-current' }] })));

      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await expect(add.matchNotice).toContainText('already in the catalog');
      await expect(add.matchNotice).toContainText('The catalog keeps its own');
      await expect(add.openLink).toHaveAttribute('href', `/papers/${existing.id}`);
      await expect(add.addButton).toHaveCount(0);
    });

    test('explains a DOI that is not one', async ({ page }) => {
      await page.route('**/api/papers/import/preview', reply(400, { statusCode: 400, code: 'invalid_doi', message: 'x' }));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('nonsense');
      await expect(add.problem).toContainText('does not look like a DOI');
      await expect(add.found).toHaveCount(0);
      await expect(add.form).toHaveCount(0);
    });

    test('opens the manual form when the provider has no record', async ({ page }) => {
      await page.route('**/api/papers/import/preview', reply(404, { statusCode: 404, code: 'not_found', message: 'x' }));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/unknown');
      await expect(add.problem).toContainText('Crossref has no record for this DOI');
      await expect(add.form).toBeVisible();
      await expect(add.titleField).toBeVisible();
    });

    test('keeps working when the provider is down: opens the form, and a retry succeeds later', async ({ page }) => {
      let calls = 0;
      await page.route('**/api/papers/import/preview', (route) =>
        calls++ === 0 ? reply(502, { statusCode: 502, code: 'provider_unavailable', message: 'x' })(route) : reply(200, preview())(route),
      );
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await expect(add.problem).toContainText('could not be reached');
      await expect(add.form).toBeVisible();

      await add.lookupButton.click();
      await expect(add.foundTitle).toHaveText(candidate.title);
      await expect(add.problem).toHaveCount(0);
    });

    test('tells the reader how long to wait when the lookups are limited', async ({ page }) => {
      await page.route('**/api/papers/import/preview', reply(429, { statusCode: 429, code: 'rate_limited', message: 'x', retryAfter: 17 }));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await expect(add.problem).toContainText('Try again in 17 seconds');
    });

    test('adds a paper typed in by hand and opens it', async ({ page }) => {
      const add = new PaperAddPage(page);
      await add.goto();
      await expect(add.form).toHaveCount(0);
      await add.openManual();
      await expect(add.saveButton).toBeDisabled();

      const title = `Typed in ${token}`;
      await add.fillManual({
        title,
        authors: 'Ada Lovelace\nGrace Hopper',
        date: '2020-05',
        venue: 'Typed Journal',
        keywords: 'typing, hands',
        abstract: 'Entered without a DOI.',
      });
      await expect(add.saveButton).toBeEnabled();
      await add.typeField.selectOption({ label: 'Preprint' });
      await add.saveButton.click();

      await expect(page).toHaveURL(/\/papers\/\d+$/);
      ids.push(Number(page.url().split('/').pop()));
      const detail = new PaperDetailPage(page);
      await expect(detail.title).toHaveText(title);
      await expect(detail.author('Grace Hopper')).toBeVisible();
      await expect(detail.fact('Type')).toContainText('Preprint');
      await expect(detail.fact('Published')).toContainText('May 2020');
      await expect(detail.keyword('typing')).toBeVisible();
    });

    test('says a hand-typed paper is already in the catalog and links to it', async ({ page }) => {
      const existing = await seed({ title: `Typed twice ${token}`, publicationDate: '2019', authors: [{ name: 'Alan Turing' }] });
      const add = new PaperAddPage(page);
      await add.goto();
      await add.fillManual({ title: `Typed twice ${token}`, authors: 'Alan Turing', date: '2019' });
      await add.saveButton.click();
      await expect(add.matchNotice).toContainText('already in the catalog');
      await expect(add.openLink).toHaveAttribute('href', `/papers/${existing.id}`);
      await expect(page).toHaveURL(/\/papers\/new$/);
    });

    test('shows what the server says when a paper cannot be told apart from others', async ({ page }) => {
      const add = new PaperAddPage(page);
      await add.goto();
      await add.fillManual({ title: `Introduction ${token}` });
      await add.saveButton.click();
      await expect(add.problem).toContainText('publication date or at least one author');
      await expect(page).toHaveURL(/\/papers\/new$/);
    });

    test('fits the screen with a result and the form open', async ({ page }) => {
      await page.route('**/api/papers/import/preview', reply(200, preview()));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await add.openManual();
      await expect(add.foundTitle).toBeVisible();
      await expect(add.form).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
});
