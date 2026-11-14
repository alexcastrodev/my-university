import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { SidebarPage } from './pages/SidebarPage.js';
import { StudiesPage } from './pages/StudiesPage.js';

// 360px is the narrow end of real phones; the tab bar has to hold five tabs there.
const PHONE = { width: 360, height: 740 };
const token = `pn${Math.random().toString(36).slice(2, 8)}`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
});

async function signIn(page) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `Phone reader ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Phone navigation through the Study tab and the library', () => {
  test('the Study tab opens a hub of cards, two per row, and Papers is not a tab', async ({ page }) => {
    const nav = new SidebarPage(page);
    const hub = new StudiesPage(page);
    await page.goto(`${BASE_URL}/dashboard`);

    await expect(nav.bottomNav).toBeVisible();
    await expect(nav.bottomTab('Papers')).toHaveCount(0);
    await expect(nav.bottomTab('Library')).toHaveCount(0);
    expect(await nav.bottomLabelsFit()).toBe(true);

    await nav.bottomTab('Study').click();
    await expect(page).toHaveURL(/\/studies$/);
    await expect(nav.bottomTab('Study')).toHaveClass(/active/);
    await expect(hub.cards).toHaveCount(4);

    const boxes = await hub.cards.evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().top));
    expect(boxes[0]).toBe(boxes[1]);
    expect(boxes[2]).toBe(boxes[3]);
    expect(boxes[2]).toBeGreaterThan(boxes[0]);
    await expectNoHorizontalScroll(page);
  });

  for (const [card, path] of [
    ['Tracks', /\/tracks$/],
    ['Certifications', /\/exams$/],
    ['Papers', /\/papers$/],
    ['Computer Science', /\/computer-science$/],
  ]) {
    test(`the ${card} card opens its page and Study stays highlighted`, async ({ page }) => {
      const nav = new SidebarPage(page);
      const hub = new StudiesPage(page);
      await page.goto(`${BASE_URL}/studies`);

      await hub.card(card).click();
      await expect(page).toHaveURL(path);
      await expect(nav.bottomTab('Study')).toHaveClass(/active/);
      await expectNoHorizontalScroll(page);
    });
  }

  test('a signed-in reader reaches the library from the tab bar', async ({ page }) => {
    const nav = new SidebarPage(page);
    await signIn(page);
    await page.goto(`${BASE_URL}/papers`);

    await expect(nav.bottomTab('Study')).toHaveClass(/active/);
    await expect(nav.bottomTab('Library')).toBeVisible();
    expect(await nav.bottomLabelsFit()).toBe(true);

    await nav.bottomTab('Library').click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(nav.bottomTab('Library')).toHaveClass(/active/);
    await expect(nav.bottomTab('Study')).not.toHaveClass(/active/);
    await expectNoHorizontalScroll(page);
  });

  test('the tab bar fits in Portuguese too', async ({ page }) => {
    const nav = new SidebarPage(page);
    await signIn(page);
    await page.goto(`${BASE_URL}/pt-BR/studies`);

    await expect(nav.bottomTab('Estudos', nav.bottomNavPt)).toBeVisible();
    await expect(nav.bottomTab('Biblioteca', nav.bottomNavPt)).toBeVisible();
    expect(await nav.bottomLabelsFit()).toBe(true);
  });
});
