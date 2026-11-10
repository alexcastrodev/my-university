import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';
import { PaperLibraryPage } from './pages/PaperLibraryPage.js';

// Personal collections (#188). The two papers are seed files (backend/src/seed/data/papers); every test signs in
// as a reader of its own, so the collections it makes are nobody else's.
const token = `co${Math.random().toString(36).slice(2, 8)}`;
const ALPHA = { id: 'foundationdb-unbundled-transactional-kv-store', title: 'FoundationDB: A Distributed Unbundled Transactional Key Value Store' };
const BETA = { id: 'metastable-failures-in-distributed-systems', title: 'Metastable Failures in Distributed Systems' };
const THESIS = `Thesis ${token}`;
const GROUP = `Reading group ${token}`;

async function signIn(request, name) {
  const res = await request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

/** Signs in as a reader with both papers in the library. */
async function reader(page, name) {
  await signIn(page.request, name);
  for (const paper of [ALPHA, BETA]) {
    const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: paper.id } });
    expect(added.ok(), await added.text()).toBeTruthy();
  }
}

/** A collection made through the API, optionally holding papers. */
async function collection(page, name, papers = []) {
  const made = await page.request.post(`${BASE_URL}/api/paper-library/collections`, { data: { name } });
  expect(made.status(), await made.text()).toBe(201);
  const { id } = await made.json();
  for (const paper of papers) {
    const put = await page.request.put(`${BASE_URL}/api/paper-library/collections/${id}/papers/${paper.id}`);
    expect(put.ok(), await put.text()).toBeTruthy();
  }
  return id;
}

test.describe('managing collections from the library', () => {
  test('makes, renames and deletes a collection, and refuses a name that is taken', async ({ page }) => {
    await reader(page, 'Maker');
    const library = new PaperLibraryPage(page);
    await library.goto();
    await expect(library.cards).toHaveCount(2);

    await library.openCollections();
    await expect(library.noCollections).toBeVisible();
    expect((await library.createCollection(THESIS)).status()).toBe(201);
    await expect(library.collectionRow(THESIS)).toBeVisible();

    expect((await library.createCollection(THESIS.toUpperCase())).status()).toBe(409);
    await expect(library.collectionProblem).toContainText('You already have a collection with that name.');

    const renamed = `${THESIS} v2`;
    expect((await library.renameCollection(THESIS, renamed)).status()).toBe(200);
    await expect(library.collectionRow(renamed)).toBeVisible();
    await expect(library.collectionRow(THESIS)).toHaveCount(0);

    await library.askToDeleteCollection(renamed);
    await expect(library.deleteConfirmation(renamed)).toBeVisible();
    expect((await library.confirmDeleteCollection(renamed)).status()).toBe(204);
    await expect(library.collectionRow(renamed)).toHaveCount(0);
    await expect(library.cards).toHaveCount(2);
  });
});

test.describe('putting papers in collections', () => {
  test('ticks a paper into two collections on its page, browses by one, and leaves the library whole when it comes out', async ({ page }) => {
    await reader(page, 'Sorter');
    await collection(page, THESIS);
    await collection(page, GROUP);

    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(ALPHA.id);
    await expect(entry.collectionBox(THESIS)).not.toBeChecked();
    expect((await entry.joinCollection(THESIS)).status()).toBe(200);
    expect((await entry.joinCollection(GROUP)).status()).toBe(200);
    await page.reload();
    await expect(entry.collectionBox(THESIS)).toBeChecked();
    await expect(entry.collectionBox(GROUP)).toBeChecked();

    const library = new PaperLibraryPage(page);
    await library.goto();
    await expect(library.cards).toHaveCount(2);
    await expect(library.card(ALPHA.title).locator('.chip-collection')).toHaveText([GROUP, THESIS]);
    await expect(library.card(BETA.title).locator('.chip-collection')).toHaveCount(0);

    await library.filterByCollection(THESIS);
    await expect(library.cards).toHaveCount(1);
    await expect(library.cardTitles).toHaveText([ALPHA.title]);
    await expect(library.activeFilters).toContainText(THESIS);
    await library.clearFilters.click();
    await expect(library.cards).toHaveCount(2);

    await entry.goto(ALPHA.id);
    expect((await entry.leaveCollection(THESIS)).status()).toBe(204);
    await library.goto(`?collection=${await idOf(page, THESIS)}`);
    await expect(library.noMatches).toBeVisible();
    await library.clearFilters.click();
    await expect(library.cards).toHaveCount(2);
    await expect(library.card(ALPHA.title).locator('.chip-collection')).toHaveText([GROUP]);
  });

  test('says there are no collections yet on the paper page, and points to the library', async ({ page }) => {
    await reader(page, 'Empty');
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(ALPHA.id);
    await expect(entry.noCollections).toBeVisible();
    await expect(entry.makeCollectionLink).toHaveAttribute('href', '/library');
  });
});

test.describe('a collection that is gone, or is not yours', () => {
  test('shows the whole library again when the collection being browsed is deleted', async ({ page }) => {
    await reader(page, 'Deleter');
    const id = await collection(page, THESIS, [ALPHA]);
    const library = new PaperLibraryPage(page);
    await library.goto(`?collection=${id}`);
    await expect(library.cards).toHaveCount(1);

    await library.openCollections();
    await library.askToDeleteCollection(THESIS);
    expect((await library.confirmDeleteCollection(THESIS)).status()).toBe(204);
    await expect(library.cards).toHaveCount(2);
    await expect(page).not.toHaveURL(/collection=/);
  });

  test('keeps a collection private: another reader sees none of it, and its id in a link shows their own library', async ({ page, browser }) => {
    await reader(page, 'Owner');
    const id = await collection(page, THESIS, [ALPHA]);

    const context = await browser.newContext();
    const other = await context.newPage();
    await reader(other, 'Stranger');
    const library = new PaperLibraryPage(other);
    await library.goto(`?collection=${id}`);
    await expect(library.cards).toHaveCount(2);
    await expect(library.collectionSelect).toHaveCount(0);
    await expect(library.errorMessage).toHaveCount(0);
    await expect(other).not.toHaveURL(/collection=/);
    await library.openCollections();
    await expect(library.noCollections).toBeVisible();
    await expect(library.collectionRow(THESIS)).toHaveCount(0);
    await context.close();
  });
});

/** The id of one of the signed-in reader's collections, by name. */
async function idOf(page, name) {
  const res = await page.request.get(`${BASE_URL}/api/paper-library/collections`);
  return (await res.json()).items.find((c) => c.name === name).id;
}
