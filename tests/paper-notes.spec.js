import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';
import { PaperReaderPage } from './pages/PaperReaderPage.js';
import { textPdf } from './pdf-fixtures.js';

// Private notes and what a reader marks on their own PDF (#186). The paper is one of the seed files
// (backend/src/seed/data/papers). Every test signs in as a reader of its own and takes its entry, and with it
// everything it wrote, away when it is done.
const token = `pn${Math.random().toString(36).slice(2, 8)}`;
const PAPER = { id: 'metastable-failures-in-distributed-systems' };
const PAGES = ['Reader test page one', 'Page two has a tardigrade', 'Page three is plain'];
const OTHER_PAGES = ['A different first page', 'A different second page with a tardigrade', 'A different third page'];

test.afterEach(async ({ page }) => {
  await page.request.delete(`${BASE_URL}/api/papers/${PAPER.id}/attachment`);
  await page.request.delete(`${BASE_URL}/api/paper-library/${PAPER.id}`);
});

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

async function uploadPdf(page, lines, status) {
  const res = await page.request.put(`${BASE_URL}/api/papers/${PAPER.id}/attachment`, {
    data: textPdf(lines),
    headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'notes.pdf' },
  });
  expect(res.status(), await res.text()).toBe(status);
}

/** Signs in and puts the paper in the library, with a PDF unless told not to. */
async function libraryWith(page, name, lines = PAGES) {
  await signIn(page, name);
  const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PAPER.id } });
  expect(added.ok(), `POST /api/paper-library: ${await added.text()}`).toBeTruthy();
  if (lines) await uploadPdf(page, lines, 201);
}

test.describe('notes on the paper page', () => {
  test('adds a note, keeps it after a reload, edits it and deletes it', async ({ page }) => {
    await libraryWith(page, 'Notes', null);
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(PAPER.id);
    await expect(entry.noNotes).toBeVisible();

    const added = await entry.addNote('Compare with the **retry storm** paper');
    expect(added.status()).toBe(201);
    await expect(entry.item('Compare with the retry storm paper')).toBeVisible();
    await expect(entry.item('retry storm').locator('strong')).toHaveText('retry storm');
    await expect(entry.noteField).toHaveValue('');

    await page.reload();
    await expect(entry.item('Compare with the retry storm paper')).toBeVisible();

    const edited = await entry.editNote(entry.noteItems().first(), 'Compare with the Metastable follow-up');
    expect(edited.status()).toBe(200);
    await expect(entry.item('Metastable follow-up')).toBeVisible();
    await expect(entry.item('retry storm')).toHaveCount(0);

    const removed = await entry.deleteNote(entry.noteItems().first());
    expect(removed.status()).toBe(204);
    await expect(entry.noNotes).toBeVisible();
    await page.reload();
    await expect(entry.noNotes).toBeVisible();
  });

  test('shows what is typed as text: no script runs, no image loads, no link runs code', async ({ page }) => {
    await libraryWith(page, 'Xss', null);
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(PAPER.id);

    const payload = '<img src=x onerror="window.xss=1"> <script>window.xss=1</script> [open](javascript:window.xss=1) ![pic](https://example.org/p.png)';
    expect((await entry.addNote(payload)).status()).toBe(201);
    await expect(entry.item('<script>')).toBeVisible();
    await page.reload();
    await expect(entry.item('<script>')).toBeVisible();

    await expect(entry.noteImages).toHaveCount(0);
    await expect(entry.noteLinks).toHaveCount(0);
    expect(await entry.scriptRan()).toBe(false);
  });

  test('does not show a note to another reader', async ({ page, browser }) => {
    await libraryWith(page, 'Owner', null);
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(PAPER.id);
    await entry.addNote('Only for me');

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signIn(otherPage, 'Intruder');
    const res = await otherPage.request.get(`${BASE_URL}/api/paper-library/${PAPER.id}/annotations`);
    expect(res.status()).toBe(404);
    const theirs = new PaperLibraryEntryPage(otherPage);
    await theirs.goto(PAPER.id);
    await expect(theirs.missing).toBeVisible();
    await expect(theirs.notes).toHaveCount(0);
    await other.close();
  });
});

test.describe('marks on the PDF', () => {
  test('highlights a passage where the text is, and draws it again after a reload and at another zoom', async ({ page }) => {
    await libraryWith(page, 'Highlight');
    const reader = new PaperReaderPage(page);
    await reader.goto(PAPER.id);

    const made = await reader.highlight(2, 'tardigrade');
    expect(made.status()).toBe(201);
    await expect(reader.marks(2, 'highlight')).toHaveCount(1);
    await expect(reader.selectionBar).toHaveCount(0);
    await expect.poll(() => reader.offset(2, 'tardigrade', 'highlight')).toBeLessThan(3);

    await reader.openPanel();
    await expect(reader.panelItems('highlight')).toHaveCount(1);
    await expect(reader.panelItems('highlight')).toContainText('tardigrade');

    await page.reload();
    await reader.reveal(2);
    await expect(reader.marks(2, 'highlight')).toHaveCount(1);
    await expect.poll(() => reader.offset(2, 'tardigrade', 'highlight')).toBeLessThan(3);

    const before = await reader.zoomLevel.textContent();
    await reader.zoomIn.click();
    await expect(reader.zoomLevel).not.toHaveText(before);
    await reader.reveal(2);
    await expect.poll(() => reader.offset(2, 'tardigrade', 'highlight')).toBeLessThan(3);

    await reader.openPanel();
    const removed = await reader.deleteMark('highlight');
    expect(removed.status()).toBe(204);
    await expect(reader.marks(2, 'highlight')).toHaveCount(0);
  });

  test('bookmarks a page and takes the bookmark away', async ({ page }) => {
    await libraryWith(page, 'Bookmark');
    const reader = new PaperReaderPage(page);
    await reader.goto(PAPER.id);
    await reader.waitDrawn(1);
    await expect(reader.bookmarkButton).toHaveAttribute('aria-pressed', 'false');

    expect((await reader.toggleBookmark()).status()).toBe(201);
    await expect(reader.bookmarkButton).toHaveAttribute('aria-pressed', 'true');
    await expect(reader.ribbon(1)).toBeVisible();

    await page.reload();
    await reader.waitDrawn(1);
    await expect(reader.ribbon(1)).toBeVisible();
    await expect(reader.bookmarkButton).toHaveAttribute('aria-pressed', 'true');

    expect((await reader.toggleBookmark()).status()).toBe(204);
    await expect(reader.ribbon(1)).toHaveCount(0);
    await expect(reader.bookmarkButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('comments and asks on a passage, and lists them on the paper page', async ({ page }) => {
    await libraryWith(page, 'Comment');
    const reader = new PaperReaderPage(page);
    await reader.goto(PAPER.id);

    expect((await reader.annotate('comment', 2, 'tardigrade', 'Why a tardigrade?')).status()).toBe(201);
    await expect(reader.panelItems('comment')).toContainText('Why a tardigrade?');
    await expect(reader.marks(2, 'comment')).toHaveCount(1);
    expect((await reader.annotate('question', 1, 'test page', 'Is this the whole page?')).status()).toBe(201);
    await expect(reader.panelItems('question')).toContainText('Is this the whole page?');
    await expect(reader.marks(1, 'question')).toHaveCount(1);
    await expect(reader.annotationsButton).toContainText('2');

    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(PAPER.id);
    await expect(entry.onPdfLine).toContainText('On your PDF: 2');
    await expect(entry.openReader).toBeVisible();
  });

  test('says the PDF was replaced when a mark is saved on the old one, and reloads on request', async ({ page }) => {
    await libraryWith(page, 'Replaced');
    const reader = new PaperReaderPage(page);
    await reader.goto(PAPER.id);
    await reader.reveal(2);

    await uploadPdf(page, OTHER_PAGES, 200);
    const refused = await reader.highlight(2, 'tardigrade');
    expect(refused.status()).toBe(409);
    await expect(reader.notice).toContainText('This PDF was replaced while you were reading');
    await expect(reader.marks(2, 'highlight')).toHaveCount(0);

    await reader.reloadButton.click();
    await expect(reader.notice).toHaveCount(0);
    await reader.reveal(2);
    await expect(reader.text(2)).toContainText('A different second page');
  });
});

test.describe('a PDF that was replaced', () => {
  test('keeps the marks for review instead of drawing them on the new file', async ({ page }) => {
    await libraryWith(page, 'Stale');
    const reader = new PaperReaderPage(page);
    await reader.goto(PAPER.id);
    expect((await reader.highlight(2, 'tardigrade')).status()).toBe(201);
    expect((await reader.annotate('question', 1, 'test page', 'Will this survive?')).status()).toBe(201);

    await uploadPdf(page, OTHER_PAGES, 200);
    await reader.goto(PAPER.id);
    await reader.reveal(2);
    await expect(reader.marks(2, 'highlight')).toHaveCount(0);
    await expect(reader.marks(1, 'question')).toHaveCount(0);
    await reader.openPanel();
    await expect(reader.needsReview).toBeVisible();
    await expect(reader.needsReview.locator('article')).toHaveCount(2);
    await expect(reader.needsReview).toContainText('of an earlier PDF (version 1)');

    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(PAPER.id);
    await expect(entry.needsReview).toBeVisible();
    await expect(entry.reviewItems()).toHaveCount(2);

    const kept = await entry.keepAsNote(entry.reviewItems().filter({ hasText: 'Will this survive?' }));
    expect(kept.status()).toBe(200);
    await expect(entry.reviewItems()).toHaveCount(1);
    await expect(entry.noteItems().filter({ hasText: 'Will this survive?' })).toBeVisible();
    await expect(entry.noteItems().filter({ hasText: 'Will this survive?' })).not.toContainText('of an earlier PDF');

    expect((await entry.deleteNote(entry.reviewItems().first())).status()).toBe(204);
    await expect(entry.needsReview).toHaveCount(0);
  });
});
