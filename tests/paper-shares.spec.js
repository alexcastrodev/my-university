import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { AnnotationShareControls } from './pages/AnnotationShareControls.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';
import { PaperReaderPage } from './pages/PaperReaderPage.js';
import { textPdf } from './pdf-fixtures.js';

// Sharing annotations on purpose (#187): the owner shares one annotation, and what a visitor, a reader who was
// named and a reader who was not each see on the paper's public page. The paper is one of the seed files
// (backend/src/seed/data/papers). Every reader is a user of its own; the owner takes the library entry, and
// with it the shares, away when the test is done.
const token = `sh${Math.random().toString(36).slice(2, 8)}`;
const PAPER = { id: 'metastable-failures-in-distributed-systems' };
let count = 0;
const unique = (label) => `${label} ${token}-${count++}`;

test.afterEach(async ({ page }) => {
  await page.request.delete(`${BASE_URL}/api/papers/${PAPER.id}/attachment`);
  await page.request.delete(`${BASE_URL}/api/paper-library/${PAPER.id}`);
});

async function signIn(request, name) {
  const res = await request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

/** A reader whose public profile can be named: a context of its own, signed in, with a profile link. */
async function namedReader(browser, name) {
  const context = await browser.newContext();
  await signIn(context.request, name);
  const slug = `${name.toLowerCase()}-${token}`;
  const res = await context.request.put(`${BASE_URL}/api/auth/profile-slug`, { data: { slug } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { context, slug, page: await context.newPage() };
}

async function visitor(browser) {
  const context = await browser.newContext();
  return { context, detail: new PaperDetailPage(await context.newPage()) };
}

/** Signs in as the owner, puts the paper in the library, and writes a note on it. */
async function ownerWithNote(page, name, text) {
  await signIn(page.request, name);
  const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PAPER.id } });
  expect(added.ok(), await added.text()).toBeTruthy();
  const entry = new PaperLibraryEntryPage(page);
  await entry.goto(PAPER.id);
  expect((await entry.addNote(text)).status()).toBe(201);
  return entry;
}

async function uploadPdf(page) {
  const res = await page.request.put(`${BASE_URL}/api/papers/${PAPER.id}/attachment`, {
    data: textPdf(['Reader test page one', 'Page two has a tardigrade', 'Page three is plain']),
    headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'shares.pdf' },
  });
  expect(res.status(), await res.text()).toBe(201);
}

test.describe('sharing a note with everyone', () => {
  test('shows it on the paper page to a visitor with its author, leaves the private notes out, and takes it back', async ({ page, browser }) => {
    const text = unique('Shared note');
    const hidden = unique('Private note');
    const entry = await ownerWithNote(page, 'Owner', text);
    expect((await entry.addNote(hidden)).status()).toBe(201);

    const controls = new AnnotationShareControls(entry.item(text));
    await expect(entry.item(text).locator('app-annotation-share')).toBeVisible();
    expect((await controls.shareWithEveryone()).status()).toBe(200);
    await expect(controls.status).toContainText('Shared with everyone who opens the paper');
    await expect(new AnnotationShareControls(entry.item(hidden)).status).toHaveCount(0);

    const { context, detail } = await visitor(browser);
    await detail.gotoWithShares(PAPER.id);
    await expect(detail.sharedItem(text)).toBeVisible();
    await expect(detail.sharedItem(text)).toContainText(`Owner ${token}`);
    await expect(detail.shared).not.toContainText(hidden);

    expect((await controls.stopSharing()).status()).toBe(204);
    await expect(controls.status).toHaveCount(0);
    await detail.gotoWithShares(PAPER.id);
    await expect(detail.sharedItem(text)).toHaveCount(0);
    await context.close();
  });

  test('says the shared copy is older after an edit, and updates it on request', async ({ page, browser }) => {
    const first = unique('First draft');
    const second = unique('Second thoughts');
    const entry = await ownerWithNote(page, 'Editor', first);
    const controls = new AnnotationShareControls(entry.noteItems().first());
    await controls.shareWithEveryone();

    expect((await entry.editNote(entry.noteItems().first(), second)).status()).toBe(200);
    await expect(controls.outdated).toBeVisible();

    const { context, detail } = await visitor(browser);
    await detail.gotoWithShares(PAPER.id);
    await expect(detail.sharedItem(first)).toBeVisible();
    await expect(detail.sharedItem(second)).toHaveCount(0);

    expect((await controls.updateCopy()).status()).toBe(200);
    await expect(controls.outdated).toHaveCount(0);
    await detail.gotoWithShares(PAPER.id);
    await expect(detail.sharedItem(second)).toBeVisible();
    await expect(detail.sharedItem(first)).toHaveCount(0);
    await context.close();
  });

  test('does not offer to share on a paper only the reader has', async ({ page }) => {
    await signIn(page.request, 'Private');
    const made = await page.request.post(`${BASE_URL}/api/paper-library/manual`, {
      data: { title: unique('My own paper'), authors: [{ name: 'Ada' }], publicationDate: '2020' },
    });
    expect(made.ok(), await made.text()).toBeTruthy();
    const { paperId } = await made.json();
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(paperId);
    const text = unique('About my own paper');
    expect((await entry.addNote(text)).status()).toBe(201);

    await expect(entry.item(text)).toBeVisible();
    await expect(new AnnotationShareControls(entry.item(text)).start).toHaveCount(0);
    await page.request.delete(`${BASE_URL}/api/paper-library/${paperId}`);
  });
});

test.describe('sharing with chosen readers', () => {
  test('shows it to the reader named and to nobody else', async ({ page, browser }) => {
    const text = unique('For Bob only');
    const entry = await ownerWithNote(page, 'Sender', text);
    const bob = await namedReader(browser, 'Bob');
    const eve = await namedReader(browser, 'Eve');
    const anyone = await visitor(browser);

    const controls = new AnnotationShareControls(entry.item(text));
    expect((await controls.shareWith(bob.slug)).status()).toBe(200);
    await expect(controls.status).toContainText(`Bob ${token}`);

    const forBob = new PaperDetailPage(bob.page);
    await forBob.gotoWithShares(PAPER.id);
    await expect(forBob.sharedItem(text)).toBeVisible();
    await expect(forBob.sharedItem(text)).toContainText('Shared with chosen readers');
    await expect(forBob.sharedItem(text)).toContainText(`Sender ${token}`);

    const forEve = new PaperDetailPage(eve.page);
    await forEve.gotoWithShares(PAPER.id);
    await expect(forEve.sharedItem(text)).toHaveCount(0);
    await anyone.detail.gotoWithShares(PAPER.id);
    await expect(anyone.detail.sharedItem(text)).toHaveCount(0);

    expect((await controls.stopSharing()).status()).toBe(204);
    await forBob.gotoWithShares(PAPER.id);
    await expect(forBob.sharedItem(text)).toHaveCount(0);
    for (const who of [bob, eve, anyone]) await who.context.close();
  });

  test('says so when nobody has the name, and shares nothing', async ({ page, browser }) => {
    const text = unique('For nobody');
    const entry = await ownerWithNote(page, 'Typo', text);
    const controls = new AnnotationShareControls(entry.item(text));

    expect((await controls.shareWith(`nobody-has-this-${token}`)).status()).toBe(400);
    await expect(controls.problem).toContainText('No reader has that public profile');
    await expect(controls.status).toHaveCount(0);

    const { context, detail } = await visitor(browser);
    await detail.gotoWithShares(PAPER.id);
    await expect(detail.sharedItem(text)).toHaveCount(0);
    await context.close();
  });
});

test.describe('sharing a highlight from the reader', () => {
  test('shows its passage and page on the paper page, and never the PDF', async ({ page, browser }) => {
    await signIn(page.request, 'Highlighter');
    await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PAPER.id } });
    await uploadPdf(page);
    const reader = new PaperReaderPage(page);
    await reader.goto(PAPER.id);
    expect((await reader.highlight(2, 'tardigrade')).status()).toBe(201);
    await reader.openPanel();

    const controls = new AnnotationShareControls(reader.panelItem('tardigrade'));
    expect((await controls.shareWithEveryone()).status()).toBe(200);
    await expect(controls.status).toContainText('Shared with everyone');

    const { context, detail } = await visitor(browser);
    await detail.gotoWithShares(PAPER.id);
    const shared = detail.sharedItem(`Highlighter ${token}`);
    await expect(shared).toContainText('tardigrade');
    await expect(shared).toContainText('Page 2');
    await expect(shared).toContainText('Highlight');

    // The PDF stays the reader's own: a visitor has no way to it.
    const file = await context.request.get(`${BASE_URL}/api/papers/${PAPER.id}/attachment/file`);
    expect(file.status()).toBe(401);
    await context.close();
  });
});
