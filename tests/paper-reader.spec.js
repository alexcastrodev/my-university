import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperAttachmentPage } from './pages/PaperAttachmentPage.js';
import { PaperReaderPage } from './pages/PaperReaderPage.js';

// The reader opens the reader's own PDF of a paper (#185). Papers are seeded through the dev-only route and every
// test signs in as a reader of its own, so a test only ever sees the PDF it uploaded.
const token = `pr${Math.random().toString(36).slice(2, 8)}`;

let api;
const catalogIds = [];

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  await Promise.all(catalogIds.splice(0).map((id) => api.delete(`/api/papers/_test/${id}`)));
  await api.dispose();
});

/** A paper in the public catalog, through the dev-only seed route. */
async function seedCatalog(title) {
  const res = await api.post('/api/papers/_test', { data: { title: `${title} ${token}`, authors: [{ name: 'Ada Lovelace' }] } });
  expect(res.ok(), `POST /api/papers/_test (needs ENABLE_DEV_AUTH=1): ${await res.text()}`).toBeTruthy();
  const id = (await res.json()).paper.id;
  catalogIds.push(id);
  return id;
}

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

async function addToLibrary(page, paperId) {
  const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId } });
  expect(added.ok(), `POST /api/paper-library: ${await added.text()}`).toBeTruthy();
}

async function uploadPdf(page, paperId, buffer) {
  const res = await page.request.put(`${BASE_URL}/api/papers/${paperId}/attachment`, {
    data: buffer,
    headers: { 'Content-Type': 'application/pdf', 'X-Filename': 'reader.pdf' },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** A complete PDF with one line of Helvetica text per page, so the reader has something to draw, select and search. */
function textPdf(lines) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${lines.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${lines.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  lines.forEach((line, i) => {
    const stream = `BT /F1 24 Tf 60 700 Td (${line}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Five pages; "tardigrade" is on pages 2 and 4, so a search for it has two matches in two places. */
const FIVE = ['Reader test page one', 'Page two has a tardigrade', 'Page three is plain', 'Page four has a tardigrade too', 'Page five is the last'];
/** Forty pages, to see that a long document is not drawn all at once. */
const LONG = Array.from({ length: 40 }, (_, i) => `Long document page ${i + 1}`);

/** Signs in, puts a catalog paper in the library with this PDF, and returns the paper's id. */
async function readerWith(page, name, lines) {
  await signIn(page, name);
  const id = await seedCatalog(name);
  await addToLibrary(page, id);
  if (lines) await uploadPdf(page, id, textPdf(lines));
  return id;
}

test.describe('PDF reader', () => {
  test.describe('who can open it', () => {
    test('asks a signed-out visitor to sign in', async ({ page }) => {
      const reader = new PaperReaderPage(page);
      await reader.goto('01a191ed-2e04-7235-ae86-8483c518560e');
      await expect(reader.signedOut).toBeVisible();
      await expect(reader.toolbar).toHaveCount(0);
    });

    test('says a paper is not in the library when it is not, or does not exist', async ({ page }) => {
      await signIn(page, 'Stranger');
      const reader = new PaperReaderPage(page);
      await reader.goto('01a191ed-2e04-7235-ae86-8483c518560e');
      await expect(reader.missing).toBeVisible();
      await reader.goto('not-an-id');
      await expect(reader.missing).toBeVisible();
    });

    test("does not open another reader's private PDF", async ({ page, browser }) => {
      const id = await readerWith(page, 'Owner', FIVE);
      const other = await browser.newContext();
      const otherPage = await other.newPage();
      await signIn(otherPage, 'Intruder');
      const reader = new PaperReaderPage(otherPage);
      await reader.goto(id);
      await expect(reader.missing).toBeVisible();
      await expect(reader.pages).toHaveCount(0);
      await other.close();
    });

    test('says so when the paper has no PDF, and points to where to add one', async ({ page }) => {
      const id = await readerWith(page, 'NoFile');
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await expect(reader.noFile).toBeVisible();
      await page.getByRole('link', { name: 'Go to the paper' }).click();
      await expect(page).toHaveURL(new RegExp(`/library/${id}$`));
    });
  });

  test.describe('opening and reading', () => {
    test('opens from the Read link on the paper page and draws the first page with its text', async ({ page }) => {
      const id = await readerWith(page, 'Opens', FIVE);
      await new PaperAttachmentPage(page).goto(id);
      await page.getByRole('link', { name: 'Read', exact: true }).click();

      const reader = new PaperReaderPage(page);
      await expect(page).toHaveURL(new RegExp(`/library/${id}/read$`));
      await expect(reader.title).toHaveText(`Opens ${token}`);
      await expect(reader.pageTotal).toHaveText('of 5');
      await expect(reader.pageInput).toHaveValue('1');
      await reader.waitDrawn(1);
      await expect(reader.text(1)).toContainText('Reader test page one');
      await expect(reader.pageBox(1).locator('canvas')).toBeVisible();
    });

    test('goes back to the paper', async ({ page }) => {
      const id = await readerWith(page, 'Back', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.backLink.click();
      await expect(page).toHaveURL(new RegExp(`/library/${id}$`));
    });

    test('loads the engine files from the app itself, none of them missing', async ({ page }) => {
      const id = await readerWith(page, 'Assets', FIVE);
      const engine = [];
      page.on('response', (res) => {
        if (res.url().includes('/pdfjs/')) engine.push({ url: res.url(), status: res.status(), type: res.headers()['content-type'] });
      });
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      const worker = engine.find((r) => r.url.endsWith('pdf.worker.min.mjs'));
      expect(worker, 'the worker is requested').toBeTruthy();
      expect(worker.type).toMatch(/javascript/);
      expect(engine.filter((r) => r.status >= 400)).toEqual([]);
    });

    test('serves the engine files under the Portuguese path too', async ({ page }) => {
      const id = await readerWith(page, 'Portugues', FIVE);
      const reader = new PaperReaderPage(page);
      const worker = page.waitForResponse((res) => res.url().includes('/pdfjs/pdf.worker.min.mjs'));
      await reader.goto(id, '/pt-BR');
      expect((await worker).status()).toBe(200);
      await expect(page.getByRole('toolbar', { name: 'Leitor de PDF' })).toBeVisible();
      await reader.waitDrawn(1);
      await expect(page.getByRole('button', { name: 'Próxima página' })).toBeEnabled();
    });
  });

  test.describe('moving through the pages', () => {
    test('goes to the next and previous page with the buttons', async ({ page }) => {
      const id = await readerWith(page, 'Buttons', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      await expect(reader.prev).toBeDisabled();

      await reader.next.click();
      await expect(reader.pageInput).toHaveValue('2');
      await reader.waitDrawn(2);
      await expect(reader.text(2)).toContainText('tardigrade');

      await reader.prev.click();
      await expect(reader.pageInput).toHaveValue('1');
    });

    test('jumps to the page typed in, and keeps it inside the document', async ({ page }) => {
      const id = await readerWith(page, 'Jump', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.pageInput.fill('4');
      await reader.pageInput.press('Enter');
      await reader.waitDrawn(4);
      await expect(reader.text(4)).toContainText('Page four');
      await expect(reader.pageInput).toHaveValue('4');

      await reader.pageInput.fill('99');
      await reader.pageInput.press('Enter');
      await expect(reader.pageInput).toHaveValue('5');
      await expect(reader.next).toBeDisabled();
    });

    test('follows the scroll: the page number is the page on screen', async ({ page }) => {
      const id = await readerWith(page, 'Scroll', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      await reader.pageBox(3).scrollIntoViewIfNeeded();
      await expect(reader.pageInput).toHaveValue('3');
    });

    test('has keyboard shortcuts: n, p, End, Home', async ({ page }) => {
      const id = await readerWith(page, 'Keys', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      await page.keyboard.press('n');
      await expect(reader.pageInput).toHaveValue('2');
      await page.keyboard.press('p');
      await expect(reader.pageInput).toHaveValue('1');
      await page.keyboard.press('End');
      await expect(reader.pageInput).toHaveValue('5');
      await page.keyboard.press('Home');
      await expect(reader.pageInput).toHaveValue('1');
    });

    test('draws only the pages near the screen in a long document', async ({ page }) => {
      const id = await readerWith(page, 'Long', LONG);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await expect(reader.pageTotal).toHaveText('of 40');
      await reader.waitDrawn(1);
      expect(await reader.drawnCount()).toBeLessThan(10);
      await expect(reader.pageBox(40).locator('canvas')).toHaveJSProperty('width', 0);

      await reader.pageInput.fill('40');
      await reader.pageInput.press('Enter');
      await reader.waitDrawn(40);
      await expect(reader.text(40)).toContainText('page 40');
      // The pages left behind gave their canvases back.
      await expect.poll(() => reader.drawnCount()).toBeLessThan(10);
      await expect(reader.pageBox(1).locator('canvas')).toHaveJSProperty('width', 0);
    });
  });

  test.describe('zoom', () => {
    test('zooms in and out in steps, and fits the width again', async ({ page }) => {
      const id = await readerWith(page, 'Zoom', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      await expect(reader.fitWidth).toHaveAttribute('aria-pressed', 'true');
      const fitted = await reader.pageWidth(1);

      await reader.zoomIn.click();
      await expect(reader.fitWidth).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => reader.pageWidth(1)).toBeGreaterThan(fitted);
      const bigger = await reader.pageWidth(1);
      await reader.waitDrawn(1);

      await reader.zoomOut.click();
      await expect.poll(() => reader.pageWidth(1)).toBeLessThan(bigger);

      await reader.fitWidth.click();
      await expect(reader.fitWidth).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => Math.abs((await reader.pageWidth(1)) - fitted)).toBeLessThan(2);
    });

    test('stops at the smallest and the largest zoom', async ({ page }) => {
      const id = await readerWith(page, 'Limits', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      // Keys, not clicks: a button that turns itself off on the last step cannot be clicked once more.
      for (let i = 0; i < 10; i++) await page.keyboard.press('+');
      await expect(reader.zoomIn).toBeDisabled();
      await expect(reader.zoomLevel).toHaveText('400%');
      for (let i = 0; i < 10; i++) await page.keyboard.press('-');
      await expect(reader.zoomOut).toBeDisabled();
      await expect(reader.zoomLevel).toHaveText('50%');
    });

    test('has keyboard shortcuts: + - 0', async ({ page }) => {
      const id = await readerWith(page, 'ZoomKeys', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      const fitted = await reader.pageWidth(1);
      await page.keyboard.press('+');
      await expect.poll(() => reader.pageWidth(1)).toBeGreaterThan(fitted);
      await page.keyboard.press('0');
      await expect(reader.fitWidth).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('-');
      await expect.poll(() => reader.pageWidth(1)).toBeLessThan(fitted);
    });
  });

  test.describe('search', () => {
    test('finds the term on its pages, goes through the matches and marks them', async ({ page }) => {
      const id = await readerWith(page, 'Find', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);

      await reader.search('Tardigrade');
      await expect(reader.searchStatus).toContainText('1 / 2 matches');
      await expect(reader.pageInput).toHaveValue('2');
      await reader.waitDrawn(2);
      await expect(reader.text(2).locator('span.hit')).toHaveCount(1);
      await expect(reader.text(2).locator('span.hit')).toContainText('tardigrade');

      await reader.nextMatch.click();
      await expect(reader.searchStatus).toContainText('2 / 2 matches');
      await expect(reader.pageInput).toHaveValue('4');

      await reader.nextMatch.click();
      await expect(reader.pageInput).toHaveValue('2');
      await reader.prevMatch.click();
      await expect(reader.pageInput).toHaveValue('4');
    });

    test('has a Find button next to the field on a wide screen', async ({ page, isMobile }) => {
      test.skip(isMobile, 'a phone submits with the search key of its keyboard');
      const id = await readerWith(page, 'FindButton', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      await reader.searchToggle.click();
      await reader.searchInput.fill('tardigrade');
      await reader.findButton.click();
      await expect(reader.searchStatus).toContainText('1 / 2 matches');
    });

    test('says when nothing matches, and clears the marks when the search is emptied', async ({ page }) => {
      const id = await readerWith(page, 'Nothing', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.search('zzzzabsent');
      await expect(reader.searchStatus).toHaveText('No matches');
      await expect(reader.nextMatch).toHaveCount(0);

      await reader.search('tardigrade');
      await reader.waitDrawn(2);
      await expect(reader.text(2).locator('span.hit')).toHaveCount(1);
      await reader.search('');
      await expect(reader.text(2).locator('span.hit')).toHaveCount(0);
    });

    test('opens with the f key and takes the term typed', async ({ page }) => {
      const id = await readerWith(page, 'Slash', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      await page.keyboard.press('f');
      await expect(reader.searchInput).toBeFocused();
      // Typing in the field is typing, not a shortcut: "n" does not turn the page.
      await page.keyboard.type('plain');
      await expect(reader.searchInput).toHaveValue('plain');
      await page.keyboard.press('Enter');
      await expect(reader.searchStatus).toContainText('1 / 1 match');
      await expect(reader.pageInput).toHaveValue('3');
    });
  });

  test.describe('a file that cannot be shown', () => {
    test('says the file is not a readable PDF, and offers the download', async ({ page }) => {
      const id = await readerWith(page, 'Broken', FIVE);
      await page.route('**/api/papers/*/attachment/file', (route) =>
        route.fulfill({ status: 200, contentType: 'application/pdf', body: 'this is plain text, not a PDF' }),
      );
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await expect(reader.corrupt).toBeVisible();
      await expect(reader.downloadLink).toBeVisible();
      await expect(reader.pages).toHaveCount(0);
    });

    test('says it could not be opened when the server fails, and tries again', async ({ page }) => {
      const id = await readerWith(page, 'Flaky', FIVE);
      let failing = true;
      await page.route('**/api/papers/*/attachment/file', (route) => (failing ? route.fulfill({ status: 500, body: 'no' }) : route.continue()));
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await expect(reader.failed).toBeVisible();
      failing = false;
      await reader.retryButton.click();
      await reader.waitDrawn(1);
      await expect(reader.failed).toHaveCount(0);
    });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test('fits the page to the screen without sideways scrolling, and keeps the controls in reach', async ({ page }) => {
      const id = await readerWith(page, 'Phone', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);

      expect(await reader.pageWidth(1)).toBeLessThanOrEqual(360);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      for (const control of [reader.prev, reader.next, reader.zoomIn, reader.zoomOut, reader.fitWidth, reader.searchToggle, reader.pageInput]) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(360);
      }
      await reader.next.click();
      await expect(reader.pageInput).toHaveValue('2');
    });

    test('keeps the bar to a few rows with the search open, so the page keeps most of the screen', async ({ page }) => {
      const id = await readerWith(page, 'PhoneSearch', FIVE);
      const reader = new PaperReaderPage(page);
      await reader.goto(id);
      await reader.waitDrawn(1);
      await reader.search('tardigrade');
      await expect(reader.searchStatus).toContainText('1 / 2 matches');
      await expect(reader.findButton).toBeHidden();
      await expect(reader.nextMatch).toBeVisible();
      // The bar stays on top of the page: it must leave most of a 740px screen to the document.
      expect((await reader.bar.boundingBox()).height).toBeLessThan(160);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      // And it does not cover the page the search went to: the page starts under the bar.
      await reader.waitDrawn(2);
      const bar = await reader.bar.boundingBox();
      const target = await reader.pageBox(2).boundingBox();
      expect(target.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    });
  });
});
