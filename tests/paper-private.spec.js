import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';
import { PaperLibraryPage } from './pages/PaperLibraryPage.js';

// A paper that is not in the catalog, added by dropping a PDF (#203). Every title carries a per-worker token, so a
// test only ever sees its own papers, and every test signs in as a reader of its own.
const token = `pv${Math.random().toString(36).slice(2, 8)}`;

let api;
const catalogIds = [];

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  await Promise.all(catalogIds.splice(0).map((id) => api.delete(`/api/papers/_test/${id}`)));
  await api.dispose();
});

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** A tiny but complete PDF: header, one empty page, xref and trailer. */
function pdf(label = 'a') {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${o}\n% ${label}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A paper in the public catalog, through the dev-only seed route. */
async function seedCatalog(data) {
  const res = await api.post('/api/papers/_test', { data });
  expect(res.ok(), `POST /api/papers/_test (needs ENABLE_DEV_AUTH=1): ${await res.text()}`).toBeTruthy();
  const { paper } = await res.json();
  catalogIds.push(paper.id);
  return paper.id;
}

/** Adds a private paper through the page and returns its public id, read from the address it opens at. */
async function addPrivate(page, title) {
  const library = new PaperLibraryPage(page);
  await library.goto();
  await library.choose({ name: 'upload.pdf', buffer: pdf(title) });
  await library.titleInput.fill(title);
  const res = await library.submit();
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).paperId;
}

test.describe('Papers that are not in the catalog', () => {
  test.describe('adding one', () => {
    test('picks a PDF, fills the title from the file name and adds a private paper', async ({ page }) => {
      await signIn(page, 'Picker');
      const library = new PaperLibraryPage(page);
      await library.goto();
      await expect(library.dropZone).toBeVisible();

      await library.choose({ name: `Notes_on_${token}_gossip.pdf`, buffer: pdf('picked') });
      await expect(library.titleInput).toHaveValue(`Notes on ${token} gossip`);
      await expect(library.doiInput).toHaveValue('');
      const res = await library.submit();
      expect(res.status()).toBe(201);
      expect(await res.json()).toMatchObject({ private: true, matched: false, library: { private: true, status: 'to-read' } });

      await expect(library.dropDone).toContainText('Added as a private paper that only you can see.');
      await expect(library.card(`Notes on ${token} gossip`)).toHaveCount(1);
      await expect(library.privateBadges).toHaveCount(1);
      await expect(library.resultsCount).toContainText('1');
      await expectNoHorizontalScroll(page);
    });

    test('takes a PDF dropped on the zone', async ({ page, isMobile }) => {
      test.skip(isMobile, 'a phone has no drag and drop: it picks a file, which the other tests cover');
      await signIn(page, 'Dropper');
      const library = new PaperLibraryPage(page);
      await library.goto();

      await library.dropFile({ name: `dropped-${token}.pdf`, buffer: pdf('dropped') });

      await expect(library.titleInput).toHaveValue(`dropped-${token}`);
      await library.titleInput.fill(`Dropped paper ${token}`);
      const res = await library.submit();
      expect(res.status()).toBe(201);
      await expect(library.card(`Dropped paper ${token}`)).toHaveCount(1);
    });

    test('lets the reader change their mind before anything is sent', async ({ page }) => {
      await signIn(page, 'Undecided');
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.choose({ name: 'never-sent.pdf', buffer: pdf('never') });

      await library.cancelButton.click();

      await expect(library.dropZone).toBeVisible();
      await expect(library.titleInput).toHaveCount(0);
      await expect(library.cards).toHaveCount(0);
    });

    test('will not add without a title', async ({ page }) => {
      await signIn(page, 'Untitled');
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.choose({ name: 'x.pdf', buffer: pdf('untitled') });

      await library.titleInput.fill('   ');

      await expect(library.addButton).toBeDisabled();
    });

    test('says why a file that is not a PDF was refused and adds nothing', async ({ page }) => {
      await signIn(page, 'Wrong file');
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.choose({ name: 'notes.pdf', buffer: Buffer.from('this is plain text, not a PDF') });
      await library.titleInput.fill(`Not a PDF ${token}`);

      const res = await library.submit();

      expect(res.status()).toBe(422);
      await expect(library.dropError).toContainText('This file is not a PDF.');
      await library.cancelButton.click();
      await expect(library.cards).toHaveCount(0);
    });

    test('says why a DOI that is not one was refused', async ({ page }) => {
      await signIn(page, 'Bad doi');
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.choose({ name: 'x.pdf', buffer: pdf('baddoi') });
      await library.titleInput.fill(`Bad DOI ${token}`);
      await library.doiInput.fill('not a doi');

      const res = await library.submit();

      expect(res.status()).toBe(400);
      await expect(library.dropError).toContainText('That is not a valid DOI.');
      await expect(library.cards).toHaveCount(0);
    });
  });

  test.describe('a private paper', () => {
    test('opens like any library paper, marked private, with no public page and its PDF attached', async ({ page }) => {
      await signIn(page, 'Owner');
      const title = `Own paper ${token} one`;
      const id = await addPrivate(page, title);

      const library = new PaperLibraryPage(page);
      await library.open(title);

      const entry = new PaperLibraryEntryPage(page);
      await expect(page).toHaveURL(new RegExp(`/library/${id}$`));
      await expect(entry.title).toHaveText(title);
      await expect(entry.privateBadge).toBeVisible();
      await expect(entry.privateNote).toBeVisible();
      await expect(entry.publicLink).toHaveCount(0);
      await expect(page.locator('.attachment .file-name')).toHaveText('upload.pdf');
      // What a reader keeps about a paper works as for any other.
      await entry.setStatus('Reading');
      await entry.addTag('mine');
      await expect(entry.tag('mine')).toBeVisible();
      await expectNoHorizontalScroll(page);
    });

    test('has no public page: not by its address, not in the catalog, not in a search', async ({ page }) => {
      await signIn(page, 'Hidden owner');
      const title = `Quietly mine ${token}`;
      const id = await addPrivate(page, title);

      const detail = new PaperDetailPage(page);
      await detail.goto(id);
      await expect(detail.notFound).toBeVisible();

      const byId = await page.request.get(`${BASE_URL}/api/papers/${id}`);
      expect(byId.status()).toBe(404);
      const search = await page.request.get(`${BASE_URL}/api/papers?q=${encodeURIComponent(title)}`);
      expect(search.status()).toBe(200);
      expect(await search.json()).toMatchObject({ total: 0, items: [] });
    });

    test('is invisible to another reader and to a visitor', async ({ page, browser }) => {
      await signIn(page, 'Secret owner');
      const title = `Only for the owner ${token}`;
      const id = await addPrivate(page, title);

      const other = await browser.newContext();
      const otherPage = await other.newPage();
      await signIn(otherPage, 'Nosy reader');
      const asOther = new PaperLibraryEntryPage(otherPage);
      await asOther.goto(id);
      await expect(asOther.missing).toBeVisible();
      const library = new PaperLibraryPage(otherPage);
      await library.goto();
      await expect(library.card(title)).toHaveCount(0);
      for (const path of [`/api/papers/${id}`, `/api/paper-library/${id}/paper`, `/api/papers/${id}/attachment/file`]) {
        const res = await otherPage.request.get(`${BASE_URL}${path}`);
        expect(res.status(), path).toBe(404);
      }
      await other.close();

      const visitor = await browser.newContext();
      const visitorPage = await visitor.newPage();
      for (const path of [`/api/papers/${id}`, `/api/paper-library/${id}/paper`]) {
        const res = await visitorPage.request.get(`${BASE_URL}${path}`);
        expect([401, 404], path).toContain(res.status());
        expect(await res.text()).not.toContain(title);
      }
      await visitor.close();
    });

    test('is deleted with its PDF and its library entry', async ({ page }) => {
      await signIn(page, 'Deleter');
      const title = `Short lived ${token}`;
      const id = await addPrivate(page, title);
      const library = new PaperLibraryPage(page);
      await library.open(title);

      const entry = new PaperLibraryEntryPage(page);
      await expect(entry.remove).toHaveCount(0);
      await entry.deletePaper.click();
      const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/api/paper-library/${id}`));
      await entry.confirmDelete.click();
      expect((await deleted).status()).toBe(204);

      await expect(page).toHaveURL(/\/library$/);
      await expect(library.empty).toBeVisible();
      for (const path of [`/api/paper-library/${id}`, `/api/paper-library/${id}/paper`, `/api/papers/${id}/attachment`]) {
        const res = await page.request.get(`${BASE_URL}${path}`);
        expect(res.status(), path).toBe(404);
      }
    });
  });

  test.describe('a DOI that is already in the catalog', () => {
    test('adds the catalog paper with the PDF instead of making a copy', async ({ page }) => {
      const doi = `10.5561/${token}`;
      const catalogTitle = `Catalog paper ${token}`;
      const catalogId = await seedCatalog({ title: catalogTitle, doi, authors: [{ name: 'Ada Lovelace' }], publicationDate: '2021' });
      await signIn(page, 'Matcher');
      const library = new PaperLibraryPage(page);
      await library.goto();
      await library.choose({ name: 'whatever.pdf', buffer: pdf('match') });
      await library.titleInput.fill('A title typed from the PDF');
      await library.doiInput.fill(`https://doi.org/${doi.toUpperCase()}`);

      const res = await library.submit();

      expect(res.status()).toBe(201);
      expect(await res.json()).toMatchObject({ paperId: catalogId, matched: true, private: false });
      await expect(library.dropDone).toContainText('already in the catalog');
      await expect(library.card(catalogTitle)).toHaveCount(1);
      await expect(library.card('A title typed from the PDF')).toHaveCount(0);
      await expect(library.privateBadges).toHaveCount(0);

      await library.openLink.click();
      const entry = new PaperLibraryEntryPage(page);
      await expect(entry.title).toHaveText(catalogTitle);
      await expect(entry.publicLink).toBeVisible();
      await expect(entry.privateBadge).toHaveCount(0);
      await expect(page.locator('.attachment .file-name')).toHaveText('whatever.pdf');

      // No second record: the catalog still has the one paper for that DOI, and nothing under the typed title.
      const byDoi = await page.request.get(`${BASE_URL}/api/papers?doi=${encodeURIComponent(doi)}`);
      expect((await byDoi.json()).total).toBe(1);
      const byTitle = await page.request.get(`${BASE_URL}/api/papers?q=${encodeURIComponent('A title typed from the PDF')}`);
      expect((await byTitle.json()).total).toBe(0);
    });
  });
});
