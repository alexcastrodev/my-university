import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { PaperAttachmentPage } from './pages/PaperAttachmentPage.js';
import { PaperDetailPage } from './pages/PaperDetailPage.js';
import { PaperLibraryEntryPage } from './pages/PaperLibraryEntryPage.js';
import { textPdf } from './pdf-fixtures.js';

// The two paper pages put the body in the middle and the side cards (an aside) on the right where there is room,
// and stack them after the title block where there is not. Nothing may be cut off or scroll sideways at any width.
// The public paper is a seed file with 21 authors, so it has the tallest aside there is; the library entry is a
// private paper whose every field is as long as the API allows, with a long tag and a long PDF name.
const token = `pg${Math.random().toString(36).slice(2, 8)}`;
const PUBLIC = 'foundationdb-unbundled-transactional-kv-store';

// The room that counts is the page's, not the screen's: the sidebar takes 56px (216 from 1200px) of it, and the
// cards go beside the body from 1000px of room. These are the viewport widths that land on each side of that.
const BESIDE = [1440, 1100];
const STACKED = [1024, 900, 768, 600, 390];

const long = (n, letter) => letter.repeat(n);
let readerId = null;

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

test.afterEach(async ({ page }) => {
  await page.request.delete(`${BASE_URL}/api/paper-library/${PUBLIC}`);
  if (readerId) await page.request.delete(`${BASE_URL}/api/paper-library/${readerId}`);
  readerId = null;
});

/** A paper only this reader has, with everything as long as it can be and no spaces to break at. */
async function longPaper(page) {
  const made = await page.request.post(`${BASE_URL}/api/paper-library/manual`, {
    data: {
      title: `${token} Supercalifragilistic${long(90, 'o')} a title that keeps going`,
      abstract: `Abstract ${long(200, 'y')}\n\nA link https://example.com/${long(150, 'z')}`,
      doi: `10.1234/${long(250, 'd')}`,
      venue: `Venue ${long(120, 'v')}`,
      publicationDate: '2024-05-06',
      url: `https://example.com/path/${long(300, 'u')}`,
      researchArea: `Area ${long(100, 'a')}`,
      type: 'journal-article',
      authors: [{ name: `Bartholomew ${long(70, 'k')}`, orcid: '0000-0002-1825-0097' }, { name: 'Ada Lovelace' }],
      keywords: [`keyword${long(60, 'q')}`, 'short'],
    },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const { paperId } = await made.json();
  readerId = paperId;
  const kept = await page.request.patch(`${BASE_URL}/api/paper-library/${paperId}`, {
    data: { tags: [`t${long(39, 'g')}`, 'short', 'another-fairly-long-tag-name'], status: 'read', completedAt: '2024-06-01' },
  });
  expect(kept.ok(), await kept.text()).toBeTruthy();
  return paperId;
}

/** The cards sit beside the body, level with the title, and stay under the top of the page while it scrolls. */
async function expectBeside(layout, width) {
  await layout.scrollTo(0);
  const { header, aside, body } = await layout.boxes();
  expect(aside.x, `aside right of the body at ${width}px`).toBeGreaterThanOrEqual(body.x + body.width);
  expect(Math.abs(aside.y - header.y), `aside level with the title at ${width}px`).toBeLessThanOrEqual(1);
  expect(aside.width, `aside width at ${width}px`).toBeGreaterThanOrEqual(280);
  expect(aside.width, `aside width at ${width}px`).toBeLessThanOrEqual(340);
  expect(body.width, `the body is the wide column at ${width}px`).toBeGreaterThan(aside.width);
  expect(await layout.position(), `aside sticks at ${width}px`).toBe('sticky');
}

/** One column: the title block, then the cards across the whole column, then the body. */
async function expectStacked(layout, width) {
  await layout.scrollTo(0);
  const { header, aside, body } = await layout.boxes();
  expect(aside.y, `aside after the title at ${width}px`).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(body.y, `body after the aside at ${width}px`).toBeGreaterThanOrEqual(aside.y + aside.height - 1);
  expect(Math.abs(aside.x - body.x), `aside in the column of the body at ${width}px`).toBeLessThanOrEqual(1);
  expect(Math.abs(aside.width - body.width), `aside as wide as the body at ${width}px`).toBeLessThanOrEqual(1);
  expect(await layout.position(), `aside does not stick at ${width}px`).toBe('static');
}

/** Nothing scrolls sideways, nothing reaches past the edge or spills out of its box, and the last card can be reached. */
async function expectFits(layout, width) {
  expect(await layout.horizontalOverflow(), `sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
  expect(await layout.partsPastTheEdge(), `parts past the edge at ${width}px`).toEqual([]);
  expect(await layout.partsWiderThanTheirBox(), `content spilling out of its box at ${width}px`).toEqual([]);
  const card = await layout.revealLastCard();
  expect(card.top, `last card top at ${width}px`).toBeGreaterThanOrEqual(-1);
  expect(card.bottom, `last card above the bottom edge at ${width}px`).toBeLessThanOrEqual(card.floor + 1);
  expect(card.left, `last card left at ${width}px`).toBeGreaterThanOrEqual(-1);
  expect(card.right, `last card right at ${width}px`).toBeLessThanOrEqual(card.width + 1);
}

test.describe('public paper page layout', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'layout public');
    const added = await page.request.post(`${BASE_URL}/api/paper-library`, { data: { paperId: PUBLIC } });
    expect(added.ok(), await added.text()).toBeTruthy();
    const paper = new PaperDetailPage(page);
    await paper.goto(PUBLIC);
    await expect(paper.aside).toBeVisible();
    // The last card is the library button, which shows once the library has answered.
    await expect(paper.libraryIn).toBeVisible();
  });

  test('keeps authors, facts, keywords and the library button in an aside beside the body, level with the title', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.layout.resize(1440);
    await expectBeside(paper.layout, 1440);
    await expect(paper.sideAuthors).toContainText('Jingyu Zhou');
    await expect(paper.sideFacts).toBeVisible();
    await expect(paper.sideKeywords.first()).toBeVisible();
    await expect(paper.sideLibrary).toBeVisible();
    await expect(paper.body).toContainText('Research Analysis');
  });

  test('keeps the aside under the top of the page while the body scrolls', async ({ page }) => {
    const paper = new PaperDetailPage(page);
    await paper.layout.resize(1440, 900);
    await paper.layout.scrollTo(1200);
    const { aside } = await paper.layout.boxes();
    expect(aside.y).toBeGreaterThanOrEqual(0);
    expect(aside.y).toBeLessThanOrEqual(40);
    expect(aside.y + aside.height).toBeLessThanOrEqual(900);
  });

  for (const width of BESIDE) {
    test(`fits ${width}px with the cards beside the body`, async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.layout.resize(width);
      await expectBeside(paper.layout, width);
      await expectFits(paper.layout, width);
    });
  }

  for (const width of STACKED) {
    test(`fits ${width}px with the cards after the title`, async ({ page }) => {
      const paper = new PaperDetailPage(page);
      await paper.layout.resize(width, width < 700 ? 844 : 900);
      await expectStacked(paper.layout, width);
      await expectFits(paper.layout, width);
    });
  }
});

test.describe('library entry page layout', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'layout entry');
    const id = await longPaper(page);
    const entry = new PaperLibraryEntryPage(page);
    await entry.goto(id);
    await expect(entry.aside).toBeVisible();
    // Fills the PDF card too, with a name that has nowhere to break.
    const attachment = new PaperAttachmentPage(page);
    const sent = await attachment.upload({ name: `${long(12, 'segment-')}final.pdf`, buffer: textPdf(['Layout']) });
    expect(sent.ok(), await sent.text()).toBeTruthy();
    await expect(attachment.fileLink).toBeVisible();
  });

  test('keeps the reading controls, the PDF and the facts in an aside beside the body, level with the title', async ({ page }) => {
    const entry = new PaperLibraryEntryPage(page);
    await entry.layout.resize(1440);
    await expectBeside(entry.layout, 1440);
    await expect(entry.sideDetails).toBeVisible();
    await expect(entry.sidePdf).toBeVisible();
    await expect(entry.sideFacts).toBeVisible();
    await expect(entry.sideRemove).toBeVisible();
    // The body is the abstract and then the notes, the last thing in the column.
    await expect(entry.bodyAbstract.first()).toBeVisible();
    await expect(entry.bodyNotes).toBeVisible();
  });

  for (const width of BESIDE) {
    test(`fits ${width}px with the cards beside the body`, async ({ page }) => {
      const entry = new PaperLibraryEntryPage(page);
      await entry.layout.resize(width);
      await expectBeside(entry.layout, width);
      await expectFits(entry.layout, width);
    });
  }

  for (const width of STACKED) {
    test(`fits ${width}px with the cards after the title`, async ({ page }) => {
      const entry = new PaperLibraryEntryPage(page);
      await entry.layout.resize(width, width < 700 ? 844 : 900);
      await expectStacked(entry.layout, width);
      await expectFits(entry.layout, width);
    });
  }
});
