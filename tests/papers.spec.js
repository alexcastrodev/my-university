import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PapersListPage } from './pages/PapersListPage.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';

// Seeds through the dev-only route (404 unless ENABLE_DEV_AUTH=1, like the test login), reads through
// the pages. Every title carries a per-worker token, so a test only sees its own papers.
const token = `pw${Math.random().toString(36).slice(2, 8)}`;
const title = (n) => `Playwright paper ${token} ${n}`;
const keyword = (n) => `kw${token}${n}`;
const ada = `Ada Lovelace ${token}`;
const grace = `Grace Hopper ${token}`;

let api;
const ids = [];

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE_URL });
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

/** The page never needs to scroll sideways, whatever the viewport. */
async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Papers catalog', () => {
  let full;
  let preprint;
  let bare;

  test.beforeAll(async () => {
    full = await seed({
      title: title('full'),
      abstract: 'First paragraph of the abstract.\n\nSecond paragraph of the abstract.',
      doi: `10.5555/${token}.full`,
      venue: 'Journal of Playwright',
      publicationDate: '2024-05',
      url: 'https://example.org/full',
      researchArea: `Area ${token}`,
      type: 'journal-article',
      authors: [{ name: ada, orcid: '0000-0002-1825-0097' }, { name: grace }],
      keywords: [keyword('a'), keyword('b')],
    });
    preprint = await seed({
      title: title('preprint'),
      abstract: 'A preprint.',
      publicationDate: '2023',
      type: 'preprint',
      authors: [{ name: 'Alan Turing' }],
      keywords: [keyword('a')],
    });
    bare = await seed({ title: title('bare'), doi: `10.5555/${token}.bare` });
  });

  test.describe('list', () => {
    test('shows each paper with its authors, type, date and keywords', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);

      await expect(papers.heading).toBeVisible();
      await expect(papers.cards).toHaveCount(3);
      await expect(papers.resultsCount).toContainText('3');

      const card = papers.card(title('full'));
      await expect(card).toContainText(`${ada}; ${grace}`);
      await expect(card).toContainText('Journal article');
      await expect(card).toContainText('May 2024');
      await expect(card).toContainText('Journal of Playwright');
      await expect(card).toContainText('First paragraph of the abstract.');
      await expect(card.getByRole('link', { name: keyword('a') })).toBeVisible();
    });

    test('shows a paper with nothing but a title and a DOI without breaking', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${title('bare')}`);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('bare')).getByRole('link', { name: title('bare') })).toHaveAttribute('href', `/papers/${bare}`);
    });

    test('searches from the box and keeps the search in the URL', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await papers.search(title('preprint'));

      await expect(page).toHaveURL(/[?&]q=/);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('preprint'))).toBeVisible();

      await page.reload();
      await expect(papers.searchInput).toHaveValue(title('preprint'));
      await expect(papers.cards).toHaveCount(1);
    });

    test('finds a paper by author, by DOI and by keyword', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await papers.search(grace);
      await expect(papers.card(title('full'))).toBeVisible();

      await papers.search(`10.5555/${token}.bare`);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('bare'))).toBeVisible();

      await papers.search(keyword('b'));
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('full'))).toBeVisible();
    });

    test('filters by publication type', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);
      await expect(papers.cards).toHaveCount(3);

      await papers.typeSelect.selectOption({ label: 'Preprint' });
      await expect(page).toHaveURL(/type=preprint/);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('preprint'))).toBeVisible();
    });

    test('says where each paper stands, so a preprint is not mistaken for a reviewed article', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);
      await expect(papers.cards).toHaveCount(3);

      await expect(papers.cardStage(title('full'))).toHaveText('Published');
      await expect(papers.cardStage(title('preprint'))).toHaveText('Preprint: not reviewed yet');
      await expect(papers.cardStage(title('bare'))).toHaveText('Status unknown');
    });

    test('filters by publication stage', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);

      await papers.stageSelect.selectOption({ label: 'Published' });
      await expect(page).toHaveURL(/stage=published/);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('full'))).toBeVisible();

      await papers.stageSelect.selectOption({ label: 'Preprint: not reviewed yet' });
      await expect(page).toHaveURL(/stage=preprint/);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('preprint'))).toBeVisible();

      await papers.stageSelect.selectOption({ label: 'All' });
      await expect(papers.cards).toHaveCount(3);
    });

    test('filters by research area', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);
      await papers.areaSelect.selectOption({ label: `Area ${token} (1)` });
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(title('full'))).toBeVisible();
    });

    test('filters by a keyword chip and lets the reader remove the filter', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);

      // A chip on a card starts a keyword filter of its own, so the search text is not carried along.
      await papers.card(title('full')).getByRole('link', { name: keyword('a') }).click();
      await expect(page).toHaveURL(new RegExp(`keyword=${keyword('a')}`));
      await expect(papers.cards).toHaveCount(2);
      await expect(papers.activeFilters).toContainText(keyword('a'));

      await papers.activeFilters.getByRole('button', { name: 'Remove filter' }).click();
      await expect(page).not.toHaveURL(/keyword=/);
      await expect(papers.activeFilters).toHaveCount(0);
    });

    test('sorts by title', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);
      await papers.sortSelect.selectOption({ label: 'Title (A to Z)' });
      await expect(page).toHaveURL(/sort=title/);
      await expect.poll(() => papers.titles()).toEqual([title('bare'), title('full'), title('preprint')]);
    });

    test('says nothing matched, and clears the filters', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}-no-such-paper`);
      await expect(papers.noMatches).toBeVisible();

      await papers.clearFilters.click();
      await expect(page).not.toHaveURL(/q=/);
      await expect(papers.noMatches).toBeHidden();
    });

    test('ignores a malformed filter in the URL instead of failing', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}&type=zine&page=abc&sort=random`);
      await expect(papers.cards).toHaveCount(3);
    });

    test('shows an error with a retry when the catalog cannot be loaded', async ({ page }) => {
      const papers = new PapersListPage(page);
      // The first load is rendered on the server, so the failure has to come from a search in the browser.
      await papers.goto();
      let failures = 1;
      await page.route(/\/api\/papers(\?|$)/, (route) => (failures-- > 0 ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));

      await papers.search(token);
      await expect(papers.errorMessage).toBeVisible();

      await papers.retryButton.click();
      await expect(papers.cards).toHaveCount(3);
    });

    test('fits the screen', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${token}`);
      await expect(papers.cards).toHaveCount(3);
      await expectNoHorizontalScroll(page);
    });
  });

  test.describe('detail', () => {
    test('opens from the list on a stable URL and shows the whole record', async ({ page }) => {
      const list = new PapersListPage(page);
      const paper = new PaperDetailPage(page);
      // The seeds are recreated for every test (new ids) while the server keeps a rendered list per URL for a
      // few minutes, so a list another test already loaded would link to ids that no longer exist.
      await list.goto(`?q=${token}&fresh=${Date.now()}`);
      await list.open(title('full'));

      await expect(page).toHaveURL(new RegExp(`/papers/${full}$`));
      await expect(paper.title).toHaveText(title('full'));
      await expect(paper.author(ada)).toBeVisible();
      await expect(paper.author(grace)).toBeVisible();
      await expect(paper.fact('Type')).toContainText('Journal article');
      await expect(paper.fact('Date')).toContainText('May 2024');
      await expect(paper.fact('Venue')).toContainText('Journal of Playwright');
      await expect(paper.fact('Research area')).toContainText(`Area ${token}`);
      await expect(paper.fact('DOI').getByRole('link')).toHaveAttribute('href', `https://doi.org/10.5555/${token}.full`);
      await expect(paper.fact('Original page').getByRole('link')).toHaveAttribute('href', 'https://example.org/full');
      await expect(paper.abstract).toHaveText(['First paragraph of the abstract.', 'Second paragraph of the abstract.']);
      await expect(paper.keyword(keyword('a'))).toBeVisible();
      await expect(paper.keyword(keyword('b'))).toBeVisible();
    });

    test('opens straight from its URL, without the paper being in anyone library', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(full);
      await expect(paper.title).toHaveText(title('full'));
      await expect(paper.discussion).toBeVisible();
    });

    test('explains where the paper stands, next to the title', async ({ page }) => {
      const paper = new PaperDetailPage(page);

      await paper.goto(preprint);
      await expect(paper.stageTitle).toContainText('Preprint: not reviewed yet');
      await expect(paper.stageText).toContainText('treat it as work in progress');

      await paper.goto(full);
      await expect(paper.stageTitle).toContainText('Published');
      await expect(paper.stageTitle).toContainText('Journal of Playwright');
      await expect(paper.stageText).toContainText('one study is never the final word');

      await paper.goto(bare);
      await expect(paper.stageTitle).toContainText('Status unknown');
      await expect(paper.stageText).toContainText('We do not know whether other experts reviewed this');
    });

    test('explains what is missing instead of leaving blanks', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(bare);

      await expect(paper.title).toHaveText(title('bare'));
      await expect(paper.noAuthors).toBeVisible();
      await expect(paper.dateUnknown).toBeVisible();
      await expect(paper.noAbstract).toBeVisible();
      await expect(paper.noKeywords).toBeVisible();
    });

    test('links an author, a keyword and a type back into the catalog', async ({ page }) => {
      const list = new PapersListPage(page);
      const paper = new PaperDetailPage(page);

      await paper.goto(full);
      await paper.author(grace).click();
      await expect(page).toHaveURL(/author=Grace/);
      await expect(list.cards).toHaveCount(1);
      await expect(list.activeFilters).toContainText(grace);

      await paper.goto(full);
      await paper.keyword(keyword('a')).click();
      await expect(list.cards).toHaveCount(2);

      await paper.goto(full);
      await paper.fact('Type').getByRole('link').click();
      await expect(page).toHaveURL(/type=journal-article/);
    });

    test('says the paper does not exist for an unknown or malformed id', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(999999999);
      await expect(paper.notFound).toBeVisible();
      await paper.goto('not-an-id');
      await expect(paper.notFound).toBeVisible();
    });

    test('asks a signed-out reader to sign in to join the discussion', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(full);
      await expect(paper.signIn).toBeVisible();
      await expect(paper.composer).toHaveCount(0);
    });

    test('lets a signed-in reader post to the paper discussion, and keeps it', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `Reader ${token}` } });
      expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();

      await paper.goto(full);
      const text = `Question about the method ${token}`;
      await paper.post(text);
      await expect(paper.posts.filter({ hasText: text })).toHaveCount(1);

      await page.reload();
      await expect(paper.posts.filter({ hasText: text })).toHaveCount(1);
    });

    test('fits the screen', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(full);
      await expect(paper.title).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
});

test.describe('Papers catalog pagination', () => {
  const total = 21;
  // Its own token: the papers above search by `token`, and with parallel tests one worker can run both groups.
  const paged = `pg${Math.random().toString(36).slice(2, 8)}`;

  test.beforeAll(async () => {
    // Sequential on purpose: each paper takes the next publication year, so the order is known.
    for (let n = 1; n <= total; n++) {
      await seed({ title: `Paged ${paged} ${String(n).padStart(2, '0')}`, publicationDate: String(1900 + n), doi: `10.5555/${paged}.p${n}` });
    }
  });

  test('splits the results in pages of twenty and moves between them', async ({ page }) => {
    const papers = new PapersListPage(page);
    await papers.goto(`?q=Paged ${paged}`);

    await expect(papers.cards).toHaveCount(20);
    await expect(papers.resultsCount).toContainText(String(total));
    await expect(papers.pageStatus).toHaveText('Page 1 of 2');
    await expect(papers.prevLink).toHaveCount(0);

    await papers.nextLink.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(papers.cards).toHaveCount(1);
    await expect(papers.cards.first()).toContainText(`Paged ${paged} 01`);
    await expect(papers.pageStatus).toHaveText('Page 2 of 2');
    await expect(papers.nextLink).toHaveCount(0);

    await papers.prevLink.click();
    await expect(papers.cards).toHaveCount(20);
    await expect(page).not.toHaveURL(/page=/);
  });
});

test.describe('Research Analysis', () => {
  const curatorName = `Curator ${token}`;
  const reviewerName = `Reviewer ${token}`;
  let curator;
  let reviewer;

  /** A signed-in API client with staff roles, granted the way the dev-only route allows. */
  async function staff(playwright, displayName, roles) {
    const client = await playwright.request.newContext({ baseURL: BASE_URL });
    const login = await client.post('/api/auth/_test/login', { data: { displayName } });
    expect(login.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
    const granted = await client.post('/api/auth/_test/roles', { data: { roles } });
    expect(granted.ok(), 'POST /api/auth/_test/roles (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
    return client;
  }

  test.beforeAll(async ({ playwright }) => {
    curator = await staff(playwright, curatorName, ['paper-curator']);
    reviewer = await staff(playwright, reviewerName, ['paper-reviewer']);
  });
  test.afterAll(async () => {
    await curator.dispose();
    await reviewer.dispose();
  });

  const sections = (tag) => ({
    overview: { state: 'present', text: `Overview ${tag}\n\nSecond paragraph ${tag}` },
    contribution: { state: 'present', text: `Contribution ${tag}` },
    methodology: { state: 'present', text: `Methodology ${tag}` },
    findings: { state: 'not_reported' },
    criticalAnalysis: { state: 'present', text: `Critical ${tag}` },
    furtherResearch: { state: 'not_applicable' },
  });

  async function newPaper(name) {
    return seed({ title: `Analysed ${token} ${name}`, abstract: 'The abstract written by the authors.', doi: `10.5555/${token}.a.${name}` });
  }
  async function saveDraft(id, body) {
    const res = await curator.put(`/api/papers/${id}/analysis/draft`, { data: { sections: body } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  async function publish(id) {
    const res = await reviewer.post(`/api/papers/${id}/analysis/publish`, { data: {} });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  test('says there is no analysis yet, and that an analysis would not be the authors', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.goto(await newPaper('none'));
    await expect(paper.analysis).toBeVisible();
    await expect(paper.noAnalysis).toBeVisible();
    await expect(paper.analysisNote).toContainText('not by the authors of the paper');
  });

  test('never shows a draft, only what was published', async ({ page }) => {
    const id = await newPaper('draft');
    await saveDraft(id, sections('secret draft'));
    const paper = new PaperDetailPage(page);
    await paper.goto(id);
    await expect(paper.noAnalysis).toBeVisible();
    await expect(page.getByText('secret draft')).toHaveCount(0);
  });

  test('shows a published analysis in the six sections, with who wrote and reviewed it', async ({ page }) => {
    const id = await newPaper('published');
    await saveDraft(id, sections('v1'));
    await publish(id);

    const paper = new PaperDetailPage(page);
    await paper.goto(id);
    await expect(paper.analysisTitles).toHaveText(['Overview', 'Contribution', 'Methodology', 'Findings', 'Critical Analysis', 'Further Research']);
    await expect(paper.analysisCredit).toContainText(curatorName);
    await expect(paper.analysisCredit).toContainText(reviewerName);
    await expect(paper.analysisCredit).toContainText('Revision');
    await expect(paper.analysisSection('Overview').locator('.analysis-text')).toHaveText(['Overview v1', 'Second paragraph v1']);
    await expect(paper.analysisSection('Methodology')).toContainText('Methodology v1');
    await expect(paper.noAnalysis).toHaveCount(0);
  });

  test('explains a section that has no text instead of leaving it blank', async ({ page }) => {
    const id = await newPaper('states');
    await saveDraft(id, { ...sections('v1'), methodology: { state: 'unable_to_determine' } });
    await publish(id);

    const paper = new PaperDetailPage(page);
    await paper.goto(id);
    await expect(paper.analysisSection('Findings')).toContainText('The paper does not report this.');
    await expect(paper.analysisSection('Further Research')).toContainText('Not applicable to this paper.');
    await expect(paper.analysisSection('Methodology')).toContainText('Could not be determined from the paper.');
  });

  test('keeps the abstract of the authors apart from the analysis', async ({ page }) => {
    const id = await newPaper('apart');
    await saveDraft(id, sections('v1'));
    await publish(id);

    const paper = new PaperDetailPage(page);
    await paper.goto(id);
    await expect(paper.abstract).toHaveText('The abstract written by the authors.');
    await expect(paper.analysis.locator('.abstract')).toHaveCount(0);
    await expect(paper.analysisNote).toContainText('abstract above is the authors');
  });

  test('shows a new revision only after it is published, and nothing once it is withdrawn', async ({ page }) => {
    const id = await newPaper('revisions');
    await saveDraft(id, sections('v1'));
    await publish(id);
    await saveDraft(id, sections('v2'));

    const paper = new PaperDetailPage(page);
    await paper.goto(id);
    await expect(paper.analysisSection('Overview')).toContainText('Overview v1');

    await publish(id);
    // The server renders a paper page once per URL for a few minutes, so a changed analysis asks with a new URL.
    await paper.goto(id, '?after=publish');
    await expect(paper.analysisSection('Overview')).toContainText('Overview v2');
    await expect(paper.analysisCredit).toContainText('2');

    const withdrawn = await reviewer.post(`/api/papers/${id}/analysis/withdraw`, { data: {} });
    expect(withdrawn.ok()).toBeTruthy();
    await paper.goto(id, '?after=withdraw');
    await expect(paper.noAnalysis).toBeVisible();
  });

  test('shows the text of a section as text, never as markup', async ({ page }) => {
    const id = await newPaper('markup');
    const hostile = '<img src=x onerror="window.__pwned=1"> <b>bold</b>';
    await saveDraft(id, { ...sections('v1'), overview: { state: 'present', text: hostile } });
    await publish(id);

    const paper = new PaperDetailPage(page);
    await paper.goto(id);
    await expect(paper.analysisSection('Overview')).toContainText(hostile);
    await expect(paper.analysis.locator('img, b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('fits the screen', async ({ page }) => {
    const id = await newPaper('fit');
    await saveDraft(id, { ...sections('v1'), overview: { state: 'present', text: `A${'very'.repeat(60)}longunbrokenword` } });
    await publish(id);

    const paper = new PaperDetailPage(page);
    await paper.goto(id);
    await expect(paper.analysisTitles).toHaveCount(6);
    await expectNoHorizontalScroll(page);
  });
});
