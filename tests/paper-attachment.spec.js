import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperAttachmentPage } from './pages/PaperAttachmentPage.js';

// Papers are seeded through the dev-only route; every test signs in as a reader of its own (with the paper in
// their library, where the PDF lives), so the PDFs of one test never show up in another.
const token = `pa${Math.random().toString(36).slice(2, 8)}`;

let api;
let paperId;

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({ baseURL: BASE_URL });
  const res = await api.post('/api/papers/_test', {
    data: { title: `Attachment paper ${token}`, authors: [{ name: 'Ada Lovelace' }], publicationDate: '2021' },
  });
  expect(res.ok(), `POST /api/papers/_test (needs ENABLE_DEV_AUTH=1): ${await res.text()}`).toBeTruthy();
  paperId = (await res.json()).paper.id;
});

test.afterAll(async () => {
  await api.delete(`/api/papers/_test/${paperId}`);
  await api.dispose();
});

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
  const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId } });
  expect(added.ok(), `POST /api/paper-library: ${await added.text()}`).toBeTruthy();
}

/** The page never needs to scroll sideways, whatever the viewport. */
async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** A tiny but complete PDF: header, one empty page, xref and trailer. `padding` makes it bigger. */
function pdf(label = 'a', padding = 0) {
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
  if (padding) body += `%${'x'.repeat(padding)}\n`;
  const xref = body.length;
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test.describe('Paper PDF', () => {
  test('asks a signed-out visitor to sign in, without an upload field', async ({ page }) => {
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    await expect(attachment.signedOut).toBeVisible();
    await expect(attachment.fileInput).toHaveCount(0);
  });

  test('uploads a PDF, lists it and serves the same bytes back', async ({ page }) => {
    await signIn(page, 'uploader');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    await expect(attachment.empty).toBeVisible();

    const bytes = pdf('first');
    const res = await attachment.upload({ name: 'my-notes.pdf', buffer: bytes });
    expect(res.status()).toBe(201);
    await expect(attachment.fileLink).toHaveText('my-notes.pdf');

    const file = await page.request.get(`${BASE_URL}/api/papers/${paperId}/attachment/file`);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toBe('application/pdf');
    expect(await file.body()).toEqual(bytes);
  });

  test('keeps the PDF after a reload', async ({ page }) => {
    await signIn(page, 'reloader');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    await attachment.upload({ name: 'kept.pdf', buffer: pdf('kept') });
    await expect(attachment.fileLink).toHaveText('kept.pdf');

    await page.reload();
    await expect(attachment.fileLink).toHaveText('kept.pdf');
  });

  test('replaces the PDF with another one', async ({ page }) => {
    await signIn(page, 'replacer');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    await attachment.upload({ name: 'v1.pdf', buffer: pdf('one') });
    await expect(attachment.fileLink).toHaveText('v1.pdf');

    const second = pdf('two');
    const res = await attachment.upload({ name: 'v2.pdf', buffer: second });
    expect(res.status()).toBe(200);
    await expect(attachment.fileLink).toHaveText('v2.pdf');

    const file = await page.request.get(`${BASE_URL}/api/papers/${paperId}/attachment/file`);
    expect(await file.body()).toEqual(second);
  });

  test('refuses a file that is not a PDF, whatever it is called', async ({ page }) => {
    await signIn(page, 'impostor');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);

    const res = await attachment.upload({ name: 'looks-fine.pdf', buffer: Buffer.from('<html><body>hello</body></html>') });
    expect(res.status()).toBe(422);
    expect((await res.json()).code).toBe('not_pdf');
    await expect(attachment.alert).toHaveText('This file is not a PDF.');
    await expect(attachment.fileLink).toHaveCount(0);
  });

  test('refuses a PDF that runs a script and keeps the earlier file', async ({ page }) => {
    await signIn(page, 'scripted');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    await attachment.upload({ name: 'clean.pdf', buffer: pdf('clean') });
    await expect(attachment.fileLink).toHaveText('clean.pdf');

    const res = await attachment.upload({ name: 'evil.pdf', buffer: pdf('/JavaScript') });
    expect(res.status()).toBe(422);
    expect((await res.json()).code).toBe('active_content');
    await expect(attachment.alert.first()).toContainText('scripts or actions');
    await expect(attachment.fileLink).toHaveText('clean.pdf');
  });

  test('refuses a file over the size limit without sending it', async ({ page }) => {
    await signIn(page, 'big');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    let sent = false;
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/attachment')) sent = true;
    });

    await attachment.fileInput.setInputFiles({ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(26 * 1024 * 1024, 0x20) });
    await expect(attachment.alert).toHaveText('The file is larger than 25 MB.');
    expect(sent).toBe(false);
  });

  test('removes the PDF only after confirming', async ({ page }) => {
    await signIn(page, 'remover');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    await attachment.upload({ name: 'gone.pdf', buffer: pdf('gone') });
    await expect(attachment.fileLink).toHaveText('gone.pdf');

    await attachment.removeButton.click();
    await attachment.cancelRemove.click();
    await expect(attachment.fileLink).toHaveText('gone.pdf');

    await attachment.remove();
    await expect(attachment.empty).toBeVisible();
    const file = await page.request.get(`${BASE_URL}/api/papers/${paperId}/attachment/file`);
    expect(file.status()).toBe(404);
  });

  test('another reader never sees my PDF', async ({ page, browser }) => {
    await signIn(page, 'owner');
    const mine = new PaperAttachmentPage(page);
    await mine.goto(paperId);
    await mine.upload({ name: 'private.pdf', buffer: pdf('private') });
    await expect(mine.fileLink).toHaveText('private.pdf');

    const other = await browser.newContext({ baseURL: BASE_URL });
    const otherPage = await other.newPage();
    await signIn(otherPage, 'stranger');
    const theirs = new PaperAttachmentPage(otherPage);
    await theirs.goto(paperId);
    await expect(theirs.empty).toBeVisible();
    await expect(theirs.fileLink).toHaveCount(0);
    expect((await otherPage.request.get(`${BASE_URL}/api/papers/${paperId}/attachment/file`)).status()).toBe(404);
    await other.close();
  });

  test('fits the screen', async ({ page }) => {
    await signIn(page, 'fitter');
    const attachment = new PaperAttachmentPage(page);
    await attachment.goto(paperId);
    await attachment.upload({ name: `a-rather-long-file-name-${token}-that-could-push-the-layout-sideways.pdf`, buffer: pdf('fit') });
    await expect(attachment.fileLink).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
