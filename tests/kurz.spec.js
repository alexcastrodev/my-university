import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { KURZ_STATUS, KurzPage, answerOf } from './pages/KurzPage.js';

// The Kurz on a concept page. The server's answers are mocked (what the student sees in each state is what
// is tested here; the checks of the answer have their own specs in the backend), the page comes from the stack.
test.describe.configure({ mode: 'serial' });

async function signIn(page) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: 'Kurz Reader' } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

test.describe('Kurz, on a computer', () => {
  test.skip(({ isMobile }) => isMobile, 'the selection menu and the side panel are for a computer');

  test('the selection menu puts the Kurz first, then the link, then "Open in"', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({});
    await kurz.goto();
    await kurz.select(0);
    await expect(kurz.menu).toBeVisible();
    const buttons = kurz.menu.getByRole('button');
    await expect(buttons.first()).toHaveAttribute('data-testid', 'ask-kurz');
    await expect(kurz.menu.getByRole('group', { name: 'Open in' }).getByRole('button')).toHaveCount(3);
    await expect(kurz.menu.getByRole('group', { name: 'Open in' })).toHaveAccessibleDescription(/outside University/);
  });

  test('asks the Kurz about a selection and reads an answer whose citation scrolls to the passage', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    let quote = '';
    await kurz.mock({ ask: (body) => answerOf(body.question, quote) });
    await kurz.goto();
    quote = (await kurz.paragraphText(0)).slice(0, 80);
    await kurz.select(0, 60);
    await kurz.askKurzButton.click();

    await expect(kurz.panel).toBeVisible();
    await expect(kurz.kurzTab).toHaveAttribute('aria-selected', 'true');
    await expect(kurz.welcome).toBeVisible();
    await expect(kurz.menu).toBeHidden(); // the menu steps aside while the panel is open

    await kurz.ask('What does it compare?');
    await expect(kurz.answers).toHaveCount(1);
    await expect(kurz.answers.first()).toContainText('two objects');
    const [sent] = kurz.asked();
    expect(sent.body.selection).toBeTruthy();
    expect(sent.body.anchorKey).toMatch(/^[0-9a-f]{16}$/);
    expect(sent.body.blockIndex).toBe(0);

    await kurz.cites.first().click();
    const highlighted = await page.evaluate(() => CSS.highlights.has('shared-highlight'));
    expect(highlighted).toBe(true);
  });

  test('the Enter shortcut asks the Kurz about the selection', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({});
    await kurz.goto();
    await kurz.select(0);
    await expect(kurz.askKurzButton).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(kurz.panel).toBeVisible();
    await expect(kurz.kurzTab).toHaveAttribute('aria-selected', 'true');
  });

  test('the paragraph marker counts the Kurz conversations next to the comments', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.goto();
    const key = await page.evaluate(async () => {
      // The page's own block key, so the mocked conversation is anchored where a real one would be.
      const el = document.querySelector('app-concept-detail-layout .section-body > p');
      const text = (el.textContent ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
    });
    const quote = (await kurz.paragraphText(0)).slice(0, 80);
    const reply = answerOf('Earlier question', quote);
    await kurz.mock({
      conversations: [
        { id: reply.conversationId, anchorKey: key, blockIndex: 0, selection: null, stale: false, updatedAt: '2030-01-01T00:00:00.000Z', messages: [reply.message] },
      ],
    });
    await page.reload();
    await kurz.paragraphs.first().waitFor();
    await expect(kurz.markers.first()).toHaveAttribute('data-count', '1');

    await kurz.markers.first().click();
    await expect(kurz.answers).toHaveCount(1);
    await expect(kurz.answers.first()).toContainText('two objects');
    await kurz.discussionTab.click();
    await expect(kurz.discussionTab).toHaveAttribute('aria-selected', 'true');
  });

  test('asks for the privacy notice and 18+ on the first question with credit', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({ status: { ...KURZ_STATUS, termsRequired: true } });
    await kurz.goto();
    await kurz.openParagraph(0);
    await expect(kurz.terms).toBeVisible();
    await expect(kurz.accept).toBeDisabled();
    await kurz.adult.check();
    await kurz.accept.click();
    await expect(kurz.terms).toBeHidden();
    await expect(kurz.input).toBeVisible();
    const posted = kurz.requests.find((r) => r.path === '/terms');
    expect(posted.body).toEqual({ version: '1', adult: true });
  });

  test('says why it cannot answer: no credit, and the platform budget, in percent', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({ status: { ...KURZ_STATUS, balance: 0, blocked: { reason: 'NO_BALANCE', resetsAt: null } } });
    await kurz.goto();
    await kurz.openParagraph(0);
    await expect(kurz.blocked).toContainText('no Kurz credits');
    await expect(kurz.sendButton).toBeDisabled();
    await expect(kurz.openIn).toBeVisible(); // "Open in" costs nothing, so it still works
  });

  test('the platform budget stops everybody, and the student reads it as a percent', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({
      status: {
        ...KURZ_STATUS,
        platformBudget: { period: 'month', usedPercent: 100, resetsAt: '2030-01-01T00:00:00.000Z' },
        blocked: { reason: 'PLATFORM_BUDGET_MONTHLY', resetsAt: '2030-01-01T00:00:00.000Z' },
      },
    });
    await kurz.goto();
    await kurz.openParagraph(0);
    await expect(kurz.blocked).toContainText('for everyone');
    await expect(kurz.budget).toContainText('100%');
    expect(JSON.stringify(kurz.requests)).not.toMatch(/\$|usd/i);
  });

  test('a refused question shows the fixed message, and a failed one says it was not charged', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    const quote = 'x';
    await kurz.mock({
      ask: (body) =>
        body.question.startsWith('refuse')
          ? answerOf(body.question, quote, { outcome: 'refused', answer: { answerable: false, blocks: [], citations: [], see: [], followUps: [] } })
          : { status: 502, body: { code: 'KURZ_UPSTREAM' } },
    });
    await kurz.goto();
    await kurz.openParagraph(0);
    await kurz.ask('refuse this');
    await expect(kurz.refused).toBeVisible();
    await kurz.ask('anything else');
    await expect(kurz.error).toContainText('not charged');
  });

  test('"Open in" takes the passage and the written question to another assistant', async ({ page, context }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({});
    await kurz.goto();
    await kurz.openParagraph(0);
    await kurz.input.fill('Why does it matter?');
    await kurz.openIn.click();
    // Before anything leaves, the menu says where it goes.
    await expect(page.getByTestId('kurz-open-in-note')).toContainText('outside University');
    await expect(page.getByRole('menu')).toHaveAccessibleDescription(/outside University/);
    const popup = context.waitForEvent('page');
    await page.getByRole('menuitem', { name: 'Claude' }).click();
    const opened = await popup;
    expect(opened.url()).toContain('claude.ai');
    expect(decodeURIComponent(opened.url())).toContain('Why does it matter?');
    await opened.close();
  });
});

test.describe('Kurz, on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the floating button and the sheet are for a phone');

  test('the floating button opens a conversation about the whole post, in a sheet', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({ ask: (body) => answerOf(body.question, 'x') });
    await kurz.goto();
    await expect(kurz.fab).toBeVisible();
    await kurz.fab.click();
    await expect(kurz.panel).toBeVisible();
    await expect(kurz.fab).toBeHidden();
    await expect(page.getByText('About the whole post')).toBeVisible();
    await expect(kurz.discussionTab).toBeHidden(); // the whole post has no paragraph discussion
    await kurz.ask('What is this post about?');
    await expect(kurz.answers).toHaveCount(1);
    expect(kurz.asked()[0].body.anchorKey).toBeUndefined();
    expect(kurz.asked()[0].body.selection).toBeUndefined();
  });

  test('a paragraph with nothing yet shows no marker, and a tap on it opens the sheet with two tabs', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({});
    await kurz.goto();
    await expect(kurz.markers.first()).toBeHidden();
    await kurz.paragraphs.first().tap();
    await expect(kurz.kurzTab).toBeVisible();
    await expect(kurz.discussionTab).toBeVisible();
  });
});

test.describe('Kurz, in the settings and the privacy notice', () => {
  test('shows the credits and limits, and asks in a dialog before erasing the conversations', async ({ page }) => {
    const kurz = new KurzPage(page);
    await signIn(page);
    await kurz.mock({});
    await page.goto('/settings');
    await expect(page.getByTestId('kurz-balance')).toHaveText('40');
    await expect(page.getByTestId('kurz-limit')).toContainText('5 of 50');
    await expect(page.getByTestId('kurz-platform')).toContainText('12%');
    const erase = page.getByTestId('kurz-erase');
    await erase.click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    expect(kurz.requests.some((r) => r.method === 'DELETE')).toBe(false); // the button only asks
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByText('Erased 3 conversations.')).toBeVisible();
  });

  test('the privacy notice is public and carries its version', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy notice');
    await expect(page.getByText('Version 1')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' }).locator('..')).toContainText('whenever you want, in Settings.'); // the space before the link survives
  });
});
