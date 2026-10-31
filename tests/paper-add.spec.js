import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperAddPage } from './pages/PaperAddPage.js';
import { PaperLibraryPage } from './pages/PaperLibraryPage.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';
import { PapersListPage } from './pages/PapersListPage.js';

// Adding a paper is only for the reader's own library (#212): the browser talks to the real API for everything
// except the Crossref lookup, the one thing a test must not call, so the lookup answers are stubbed at the
// browser. The server side of the lookup, import and creation is covered against a stub Crossref in
// backend/spec/papers-import.spec.ts.
const token = `pa${Math.random().toString(36).slice(2, 8)}`;
const catalogIds = [];
let api;

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE_URL });
});
test.afterAll(async () => {
  await Promise.all(catalogIds.splice(0).map((id) => api.delete(`/api/papers/_test/${id}`)));
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
  catalogIds.push(paper.id);
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
  ...over,
});
const added = (paperId, over = {}) => ({
  paperId,
  private: false,
  matched: true,
  created: true,
  library: { paperId, private: false, status: 'to-read', rating: null, tags: [], addedAt: new Date().toISOString(), completedAt: null },
  ...over,
});
const reply = (status, body) => (route) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const PREVIEW = '**/api/paper-library/import/preview';

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

  test('is not offered on the public list: it belongs to the library', async ({ page }) => {
    const list = new PapersListPage(page);
    await list.goto();
    await expect(list.addPaperLink).toHaveCount(0);
  });

  test('the old address leads to the library page', async ({ page }) => {
    await page.goto('/papers/new');
    await expect(page).toHaveURL(/\/library\/add$/);
    await expect(new PaperAddPage(page).heading).toBeVisible();
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    test('is reached from the library, and goes back to it', async ({ page }) => {
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.addPaperLink.click();
      await expect(page).toHaveURL(/\/library\/add$/);
      const add = new PaperAddPage(page);
      await expect(add.heading).toBeVisible();
      await add.backLink.click();
      await expect(page).toHaveURL(/\/library$/);
    });

    test('previews what the DOI is, then adds it and opens it in the library', async ({ page }) => {
      const real = await seed({ title: `Opened after adding ${token}`, doi: `10.5555/${token}.opened` });
      let lookedUp;
      let imported;
      await page.route(PREVIEW, (route) => {
        lookedUp = route.request().postDataJSON();
        return reply(200, preview())(route);
      });
      // The provider is stubbed, so the entry the real add would make is made here, and the stub answers with it.
      await page.request.post('/api/paper-library', { data: { paperId: real.id } });
      await page.route(/\/api\/paper-library\/import$/, (route) => {
        imported = route.request().postDataJSON();
        return reply(201, added(real.id, { matched: false }))(route);
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
      await expect(page).toHaveURL(new RegExp(`/library/${real.id}$`));
      await expect(new PaperLibraryEntryPage(page).title).toHaveText(`Opened after adding ${token}`);
      // The server fetches the metadata itself: the browser sends the DOI and nothing else.
      expect(imported).toEqual({ doi: '10.5555/stubbed' });
    });

    test('says a catalog paper is used as it is, and adds it on request', async ({ page }) => {
      const real = await seed({ title: `In the catalog ${token}`, doi: `10.5555/${token}.catalog` });
      await page.route(PREVIEW, reply(200, preview({ match: { paperId: real.id, title: real.title, private: false, inLibrary: false } })));
      await page.request.post('/api/paper-library', { data: { paperId: real.id } });
      await page.route(/\/api\/paper-library\/import$/, reply(201, added(real.id)));

      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await expect(add.matchNotice).toContainText('in the catalog');
      await expect(add.matchNotice).toContainText('puts that paper in your library');
      await add.addButton.click();
      await expect(page).toHaveURL(new RegExp(`/library/${real.id}$`));
    });

    test('says the paper is already in the library and links to it, with nothing to add', async ({ page }) => {
      const real = await seed({ title: `Already here ${token}`, doi: `10.5555/${token}.here` });
      await page.route(PREVIEW, reply(200, preview({ match: { paperId: real.id, title: real.title, private: false, inLibrary: true } })));

      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await expect(add.matchNotice).toContainText('already in your library');
      await expect(add.openLink).toHaveAttribute('href', `/library/${real.id}`);
      await expect(add.addButton).toHaveCount(0);
    });

    test('explains a DOI that is not one', async ({ page }) => {
      await page.route(PREVIEW, reply(400, { statusCode: 400, code: 'invalid_doi', message: 'x' }));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('nonsense');
      await expect(add.problem).toContainText('does not look like a DOI');
      await expect(add.found).toHaveCount(0);
      await expect(add.form).toHaveCount(0);
    });

    test('opens the manual form when the provider has no record', async ({ page }) => {
      await page.route(PREVIEW, reply(404, { statusCode: 404, code: 'not_found', message: 'x' }));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/unknown');
      await expect(add.problem).toContainText('Crossref has no record for this DOI');
      await expect(add.form).toBeVisible();
      await expect(add.titleField).toBeVisible();
    });

    test('keeps working when the provider is down: opens the form, and a retry succeeds later', async ({ page }) => {
      let calls = 0;
      await page.route(PREVIEW, (route) =>
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
      await page.route(PREVIEW, reply(429, { statusCode: 429, code: 'rate_limited', message: 'x', retryAfter: 17 }));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await expect(add.problem).toContainText('Try again in 17 seconds');
    });

    test('says so when the reader has reached the limit of papers of their own', async ({ page }) => {
      await page.route(PREVIEW, reply(200, preview()));
      await page.route(/\/api\/paper-library\/import$/, reply(409, { statusCode: 409, code: 'private_papers_limit', message: 'x' }));
      const add = new PaperAddPage(page);
      await add.goto();
      await add.lookup('10.5555/stubbed');
      await add.addButton.click();
      await expect(add.problem).toContainText('limit of papers of your own');
      await expect(page).toHaveURL(/\/library\/add$/);
    });

    test('adds a paper typed in by hand, private to the reader, and opens it in the library', async ({ page }) => {
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

      await expect(page).toHaveURL(/\/library\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const id = page.url().split('/').pop();
      try {
        const entry = new PaperLibraryEntryPage(page);
        await expect(entry.title).toHaveText(title);
        await expect(entry.privateBadge).toBeVisible();
        await expect(entry.authors).toContainText('Grace Hopper');
        await expect(entry.fact('Type')).toContainText('Preprint');
        // It has no public page, and the public list does not know it.
        expect((await api.get(`/api/papers/${id}`)).status()).toBe(404);
        const list = await (await api.get(`/api/papers?q=${token}`)).json();
        expect(list.total).toBe(0);
      } finally {
        await page.request.delete(`/api/paper-library/${id}`);
      }
    });

    test('says a hand-typed paper is already in the library and links to it', async ({ page }) => {
      const body = { title: `Typed twice ${token}`, publicationDate: '2019', authors: [{ name: 'Alan Turing' }] };
      const first = await page.request.post('/api/paper-library/manual', { data: body });
      expect(first.status()).toBe(201);
      const { paperId } = await first.json();
      try {
        const add = new PaperAddPage(page);
        await add.goto();
        await add.fillManual({ title: body.title, authors: 'Alan Turing', date: '2019' });
        await add.saveButton.click();
        await expect(add.matchNotice).toContainText('already in your library');
        await expect(add.openLink).toHaveAttribute('href', `/library/${paperId}`);
        await expect(page).toHaveURL(/\/library\/add$/);
      } finally {
        await page.request.delete(`/api/paper-library/${paperId}`);
      }
    });

    test('shows what the server says when a paper cannot be told apart from others', async ({ page }) => {
      const add = new PaperAddPage(page);
      await add.goto();
      await add.fillManual({ title: `Introduction ${token}` });
      await add.saveButton.click();
      await expect(add.problem).toContainText('publication date or at least one author');
      await expect(page).toHaveURL(/\/library\/add$/);
    });

    test('fits the screen with a result and the form open', async ({ page }) => {
      await page.route(PREVIEW, reply(200, preview()));
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
