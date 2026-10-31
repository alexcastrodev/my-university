import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PapersListPage } from './pages/PapersListPage.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';

// The public papers are files (backend/src/seed/data/papers), so these tests read the real seed through the
// pages: nothing is created, and a change to a paper there is a change to what these tests expect.
const SEED = 12;
const FDB = {
  slug: 'foundationdb-unbundled-transactional-kv-store',
  title: 'FoundationDB: A Distributed Unbundled Transactional Key Value Store',
  titlePt: 'FoundationDB: um armazenamento chave-valor transacional, distribuído e desagregado',
  doi: '10.1145/3448016.3457559',
};
const TIDB = { slug: 'tidb-raft-based-htap-database', title: 'TiDB: A Raft-based HTAP Database' };
const METASTABLE = {
  slug: 'metastable-failures-in-distributed-systems',
  title: 'Metastable Failures in Distributed Systems',
  titlePt: 'Falhas metaestáveis em sistemas distribuídos',
  doi: '10.1145/3458336.3465286',
};
const PAGED = {
  slug: 'pagedattention-memory-management-for-llm-serving',
  title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention',
  titlePt: 'Gerenciamento eficiente de memória para servir modelos de linguagem grandes com PagedAttention',
  doi: '10.1145/3600006.3613165',
};
const SCALLOP = {
  slug: 'scallop-sdn-inspired-sfu-for-video-conferencing',
  title: 'Scalable Video Conferencing Using SDN Principles',
  titlePt: 'Videoconferência escalável com princípios de SDN',
  doi: '10.1145/3718958.3750489',
};
// A USENIX paper: open access, with no DOI, only the page of the conference.
const SALSIFY = {
  slug: 'salsify-low-latency-video-codec-and-transport',
  title: 'Salsify: Low-Latency Network Video through Tighter Integration between a Video Codec and a Transport Protocol',
};
const SECTIONS = ['Overview', 'Contribution', 'Methodology', 'Findings', 'Critical Analysis', 'Further Research'];
const SECTIONS_PT = ['Visão geral', 'Contribuição', 'Metodologia', 'Resultados', 'Análise crítica', 'Pesquisas futuras'];
const run = Math.random().toString(36).slice(2, 8);

/** The page never needs to scroll sideways, whatever the viewport. */
async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Papers catalog', () => {
  test.describe('list', () => {
    test('shows each paper with its authors, type, date and keywords', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();

      await expect(papers.heading).toBeVisible();
      await expect(papers.cards).toHaveCount(SEED);
      await expect(papers.resultsCount).toContainText(String(SEED));

      const card = papers.card(METASTABLE.title);
      await expect(card).toContainText('Nathan Bronson');
      await expect(card).toContainText('Conference paper');
      await expect(card).toContainText('June 2021');
      await expect(card).toContainText('Proceedings of the Workshop on Hot Topics in Operating Systems');
      await expect(card.getByRole('link', { name: 'resilience' })).toBeVisible();
    });

    test('lists the newest paper first, as a reference row with its DOI, initials and links to the sources', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await expect(papers.cards).toHaveCount(SEED);

      expect((await papers.titles())[0]).toBe(SCALLOP.title);
      await expect(papers.cardRef(SCALLOP.title)).toHaveText(`[1] / DOI ${SCALLOP.doi}`);
      await expect(papers.cardAvatars(SCALLOP.title).first()).toHaveText('OM');
      await expect(papers.cardSource(SCALLOP.title, 'DOI')).toHaveAttribute('href', `https://doi.org/${SCALLOP.doi}`);
      await expect(papers.cardSource(SCALLOP.title, 'Page')).toHaveAttribute('href', `https://dl.acm.org/doi/${SCALLOP.doi}`);
      await expect(papers.card(FDB.title)).toContainText('more');
      await expectNoHorizontalScroll(page);
    });

    test('shows a paper that has no DOI with its place in the result and a link to its page only', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();

      await expect(papers.cardRef(SALSIFY.title)).toHaveText(/^\[\d+\]$/);
      await expect(papers.cardSource(SALSIFY.title, 'DOI')).toHaveCount(0);
      await expect(papers.cardSource(SALSIFY.title, 'Page')).toHaveAttribute('href', 'https://www.usenix.org/conference/nsdi18/presentation/fouladi');
      await expectNoHorizontalScroll(page);
    });

    test('searches from the box and keeps the search in the URL', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await papers.search(TIDB.title);

      await expect(page).toHaveURL(/[?&]q=/);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(TIDB.title)).toBeVisible();

      await page.reload();
      await expect(papers.searchInput).toHaveValue(TIDB.title);
      await expect(papers.cards).toHaveCount(1);
    });

    test('finds a paper by author, by DOI and by keyword', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await papers.search('Nathan Bronson');
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(METASTABLE.title)).toBeVisible();

      await papers.search(FDB.doi);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(FDB.title)).toBeVisible();

      await papers.search('kernel bypass');
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card('Demikernel')).toBeVisible();
    });

    test('filters by publication type', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await expect(papers.cards).toHaveCount(SEED);

      await papers.typeSelect.selectOption({ label: 'Journal article' });
      await expect(page).toHaveURL(/type=journal-article/);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(TIDB.title)).toBeVisible();
    });

    test('says where each paper stands, and filters by it', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await expect(papers.cards).toHaveCount(SEED);
      await expect(papers.cardStage(TIDB.title)).toHaveText('Published');
      await expect(papers.cardStage(METASTABLE.title)).toHaveText('Published');

      await papers.stageSelect.selectOption({ label: 'Published' });
      await expect(page).toHaveURL(/stage=published/);
      await expect(papers.cards).toHaveCount(SEED);

      // The seed holds no preprint: the filter finds none.
      await papers.stageSelect.selectOption({ label: 'Preprint: not reviewed yet' });
      await expect(page).toHaveURL(/stage=preprint/);
      await expect(papers.noMatches).toBeVisible();

      await papers.stageSelect.selectOption({ label: 'All' });
      await expect(papers.cards).toHaveCount(SEED);
    });

    test('filters by research area', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await papers.areaSelect.selectOption({ label: 'Operating Systems (3)' });
      await expect(papers.cards).toHaveCount(3);
      await expect(papers.card('Snap')).toBeVisible();
      await expect(papers.card('ghOSt')).toBeVisible();
      await expect(papers.card('Demikernel')).toBeVisible();
    });

    test('groups the five video-conferencing papers under Computer Networks, in either language', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await papers.areaSelect.selectOption({ label: 'Computer Networks (5)' });
      await expect(papers.cards).toHaveCount(5);
      await expect(papers.card(SCALLOP.title)).toBeVisible();
      await expect(papers.card(SALSIFY.title)).toBeVisible();

      await papers.gotoPortuguese('?area=Computer+Networks');
      await expect(papers.cards).toHaveCount(5);
      await expect(papers.areaSelectPortuguese.locator('option', { hasText: 'Redes de computadores' })).toHaveCount(1);
      await expect(papers.cardArea(SCALLOP.titlePt)).toHaveText('Redes de computadores');
      await expect(papers.cardOriginalTitle(SCALLOP.titlePt)).toHaveText(`Título original: ${SCALLOP.title}`);
    });

    test('filters by a keyword chip and lets the reader remove the filter', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();

      await papers.card(FDB.title).getByRole('link', { name: 'oltp' }).click();
      await expect(page).toHaveURL(/keyword=oltp/);
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.activeFilters).toContainText('oltp');

      await papers.activeFilters.getByRole('button', { name: 'Remove filter' }).click();
      await expect(page).not.toHaveURL(/keyword=/);
      await expect(papers.activeFilters).toHaveCount(0);
      await expect(papers.cards).toHaveCount(SEED);
    });

    test('sorts by title', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto('?area=Databases');
      await papers.sortSelect.selectOption({ label: 'Title (A to Z)' });
      await expect(page).toHaveURL(/sort=title/);
      await expect.poll(() => papers.titles()).toEqual([FDB.title, TIDB.title]);
    });

    test('says nothing matched, and clears the filters', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto(`?q=${run}-no-such-paper`);
      await expect(papers.noMatches).toBeVisible();

      await papers.clearFilters.click();
      await expect(page).not.toHaveURL(/q=/);
      await expect(papers.noMatches).toBeHidden();
      await expect(papers.cards).toHaveCount(SEED);
    });

    test('ignores a malformed filter in the URL instead of failing', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto('?type=zine&page=abc&sort=random');
      await expect(papers.cards).toHaveCount(SEED);
    });

    test('shows an error with a retry when the catalog cannot be loaded', async ({ page }) => {
      const papers = new PapersListPage(page);
      // The first load is rendered on the server, so the failure has to come from a search in the browser.
      await papers.goto();
      let failures = 1;
      await page.route(/\/api\/papers(\?|$)/, (route) => (failures-- > 0 ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));

      await papers.search('FoundationDB');
      await expect(papers.errorMessage).toBeVisible();

      await papers.retryButton.click();
      await expect(papers.cards).toHaveCount(1);
    });

    test('lists the same papers in Portuguese', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.gotoPortuguese();
      await expect(papers.cards).toHaveCount(SEED);
      await expect(papers.card(METASTABLE.titlePt)).toContainText('junho de 2021');
    });

    test('shows the area and the start of the abstract in Portuguese, and keeps an English link working', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.gotoPortuguese();

      await expect(papers.cardArea(PAGED.titlePt)).toHaveText('Sistemas para aprendizado de máquina');
      await expect(papers.cardExcerpt(PAGED.titlePt)).toContainText('Servir modelos de linguagem grandes');
      await expect(papers.areaSelectPortuguese.locator('option', { hasText: 'Sistemas operacionais' })).toHaveCount(1);
      await expect(papers.areaSelectPortuguese.locator('option', { hasText: 'Operating Systems' })).toHaveCount(0);

      // A link copied from the English list still finds the paper after the switch of language.
      await papers.gotoPortuguese('?area=Machine+Learning+Systems');
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(PAGED.titlePt)).toBeVisible();
    });

    test('shows the translated title with the published one under it, and finds a paper by either', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.gotoPortuguese();

      await expect(papers.card(METASTABLE.titlePt).getByRole('heading', { level: 2 })).toHaveText(METASTABLE.titlePt);
      await expect(papers.cardOriginalTitle(METASTABLE.titlePt)).toHaveText(`Título original: ${METASTABLE.title}`);

      // A search typed in English still finds it, and so does one in Portuguese.
      await papers.gotoPortuguese('?q=Metastable+Failures');
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(METASTABLE.titlePt)).toBeVisible();
      await papers.gotoPortuguese('?q=metaest%C3%A1veis');
      await expect(papers.cards).toHaveCount(1);
      await expect(papers.card(METASTABLE.titlePt)).toBeVisible();
    });

    test('keeps the published title alone for an English reader', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();

      await expect(papers.card(METASTABLE.title)).toBeVisible();
      await expect(papers.cardOriginalTitle(METASTABLE.title)).toHaveCount(0);
    });

    test('keeps the English texts for an English reader', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();

      await expect(papers.cardArea(PAGED.title)).toHaveText('Machine Learning Systems');
      await expect(papers.cardExcerpt(PAGED.title)).toContainText('High throughput serving of large language models');
    });

    test('fits the screen', async ({ page }) => {
      const papers = new PapersListPage(page);
      await papers.goto();
      await expect(papers.cards).toHaveCount(SEED);
      await expectNoHorizontalScroll(page);
    });
  });

  test.describe('detail', () => {
    test('opens from the list on the slug of the paper and shows the whole record', async ({ page }) => {
      const list = new PapersListPage(page);
      const paper = new PaperDetailPage(page);
      await list.goto();
      await list.open(METASTABLE.title);

      await expect(page).toHaveURL(new RegExp(`/papers/${METASTABLE.slug}$`));
      await expect(paper.title).toHaveText(METASTABLE.title);
      await expect(paper.author('Nathan Bronson')).toBeVisible();
      await expect(paper.fact('Type')).toContainText('Conference paper');
      await expect(paper.fact('Date')).toContainText('June 2021');
      await expect(paper.fact('Venue')).toContainText('Hot Topics in Operating Systems');
      await expect(paper.fact('Research area')).toContainText('Distributed Systems');
      await expect(paper.fact('DOI').getByRole('link')).toHaveAttribute('href', `https://doi.org/${METASTABLE.doi}`);
      await expect(paper.fact('Original page').getByRole('link')).toHaveAttribute('href', `https://dl.acm.org/doi/${METASTABLE.doi}`);
      await expect(paper.keyword('resilience')).toBeVisible();
    });

    test('opens straight from its URL, without the paper being in anyone library', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(FDB.slug);
      await expect(paper.title).toHaveText(FDB.title);
      await expect(paper.discussion).toBeVisible();
    });

    test('explains where the paper stands, next to the title', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(TIDB.slug);
      await expect(paper.stageTitle).toContainText('Published');
      await expect(paper.stageText).toContainText('one study is never the final word');
    });

    test('shows the abstract of the authors when the file has one, and says so when it has none', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(PAGED.slug);
      await expect(paper.abstract.first()).toContainText('High throughput serving of large language models');

      await paper.goto(FDB.slug);
      await expect(paper.noAbstract).toBeVisible();
      await expect(paper.analysis).toBeVisible();
    });

    test('links an author, a keyword and a type back into the catalog', async ({ page }) => {
      const list = new PapersListPage(page);
      const paper = new PaperDetailPage(page);

      await paper.goto(METASTABLE.slug);
      await paper.author('Nathan Bronson').click();
      await expect(page).toHaveURL(/author=Nathan/);
      await expect(list.cards).toHaveCount(1);
      await expect(list.activeFilters).toContainText('Nathan Bronson');

      await paper.goto(METASTABLE.slug);
      await paper.keyword('outages').click();
      await expect(page).toHaveURL(/keyword=outages/);
      await expect(list.cards).toHaveCount(1);

      await paper.goto(TIDB.slug);
      await paper.fact('Type').getByRole('link').click();
      await expect(page).toHaveURL(/type=journal-article/);
    });

    test('says the paper does not exist for an unknown id, a malformed one, a UUID or an old integer', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      for (const id of ['no-such-paper', 'Not_A_Slug', '01a191ed-2e04-7235-ae86-8483c518560e', '12345']) {
        await paper.goto(id);
        await expect(paper.notFound, id).toBeVisible();
      }
    });

    test('asks a signed-out reader to sign in to join the discussion', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(FDB.slug);
      await expect(paper.signIn).toBeVisible();
      await expect(paper.composer).toHaveCount(0);
    });

    test('lets a signed-in reader post to the paper discussion, and keeps it', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `Reader ${run}` } });
      expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();

      await paper.goto(FDB.slug);
      const text = `Question about the method ${run}`;
      await paper.post(text);
      await expect(paper.posts.filter({ hasText: text })).toHaveCount(1);

      await page.reload();
      await expect(paper.posts.filter({ hasText: text })).toHaveCount(1);
    });

    test('fits the screen', async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.goto(PAGED.slug);
      await expect(paper.title).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
});

test.describe('Research Analysis', () => {
  test('shows the six sections in order, written by Kurz and not by the authors', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.goto(FDB.slug);

    await expect(paper.analysisNote).toContainText('Written by Kurz, not by the authors of the paper');
    await expect(paper.analysisTitles).toHaveText(SECTIONS);
    await expect(paper.analysisBodies).toHaveCount(SECTIONS.length);
    for (const title of SECTIONS) {
      await expect(paper.analysisSection(title).locator('.section-body')).not.toBeEmpty();
    }
  });

  test('says when it was last revised and which version it is, with no reviewer or publisher', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.goto(FDB.slug);

    await expect(paper.analysisCredit).toContainText('Last revised');
    await expect(paper.analysisCredit).toContainText('October 31, 2026');
    await expect(paper.analysisCredit).toContainText('Version');
    await expect(paper.analysisCredit).toContainText('1.2');
    await expect(paper.analysisCredit).not.toContainText('Reviewed by');
    await expect(paper.analysisCredit).not.toContainText('Published');
  });

  test('keeps the abstract of the authors apart from the analysis', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.goto(PAGED.slug);

    await expect(paper.abstract.first()).toBeVisible();
    await expect(paper.analysis.locator('.abstract')).toHaveCount(0);
    await expect(paper.analysisNote).toContainText('The abstract above is the authors');
  });

  test('is in Portuguese on the Portuguese page, which points to both languages for search engines', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.gotoPortuguese(FDB.slug);

    await expect(paper.title).toHaveText(FDB.titlePt);
    await expect(paper.originalTitle).toHaveText(`Título original: ${FDB.title}`);
    await expect(paper.analysisTitles).toHaveText(SECTIONS_PT);
    await expect(paper.analysisNote).toContainText('Escrita pelo Kurz');
    await expect(paper.analysisCredit).toContainText('Última revisão');
    await expect(paper.analysisCredit).toContainText('31 de outubro de 2026');
    await expect(paper.alternates.first()).toHaveAttribute('href', /\/papers\/foundationdb-unbundled-transactional-kv-store$/);
    await expect(page.locator('link[rel="alternate"][hreflang="pt-BR"]')).toHaveAttribute('href', /\/pt-BR\/papers\/foundationdb/);
  });

  test('translates the abstract, the keywords and the area on the Portuguese page, and says so', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.gotoPortuguese(PAGED.slug);

    await expect(paper.title).toHaveText(PAGED.titlePt);
    await expect(paper.originalTitle).toHaveText(`Título original: ${PAGED.title}`);
    await expect(paper.abstract.first()).toContainText('Servir modelos de linguagem grandes');
    await expect(paper.abstractNote).toHaveText('Tradução nossa do resumo original dos autores, em inglês.');
    await expect(paper.area).toHaveText('Sistemas para aprendizado de máquina');
    await expect(paper.keywords).toContainText(['inferência de llms', 'cache kv', 'memória virtual', 'paginação', 'memória de gpu']);
  });

  test('keeps the English abstract, keywords and area for an English reader, with no note about a translation', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.goto(PAGED.slug);

    await expect(paper.title).toHaveText(PAGED.title);
    await expect(paper.originalTitle).toHaveCount(0);
    await expect(paper.abstract.first()).toContainText('High throughput serving of large language models');
    await expect(paper.abstractNote).toHaveCount(0);
    await expect(paper.area).toHaveText('Machine Learning Systems');
    await expect(paper.keywords).toContainText(['llm serving', 'kv cache', 'virtual memory', 'paging', 'gpu memory']);
  });

  test('fits the screen', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.goto(FDB.slug);
    await expect(paper.analysisTitles).toHaveCount(SECTIONS.length);
    await expectNoHorizontalScroll(page);
  });
});
