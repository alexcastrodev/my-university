import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { SidebarPage } from './pages/SidebarPage.js';

// 360px is the narrow end of real phones; the tab bar has to hold six tabs there.
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

test.describe('Phone navigation to Papers and the library', () => {
  test('a visitor gets Papers in the tab bar and no Library', async ({ page }) => {
    const nav = new SidebarPage(page);
    await page.goto(`${BASE_URL}/computer-science`);

    await expect(nav.bottomNav).toBeVisible();
    await expect(nav.bottomTab('Papers')).toBeVisible();
    await expect(nav.bottomTab('Library')).toHaveCount(0);
    expect(await nav.bottomLabelsFit()).toBe(true);

    await nav.bottomTab('Papers').click();
    await expect(page).toHaveURL(/\/papers$/);
    await expect(nav.bottomTab('Papers')).toHaveClass(/active/);
    await expectNoHorizontalScroll(page);
  });

  test('a signed-in reader reaches the library from the tab bar', async ({ page }) => {
    const nav = new SidebarPage(page);
    await signIn(page);
    await page.goto(`${BASE_URL}/papers`);

    await expect(nav.bottomTab('Papers')).toBeVisible();
    await expect(nav.bottomTab('Library')).toBeVisible();
    expect(await nav.bottomLabelsFit()).toBe(true);

    await nav.bottomTab('Library').click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(nav.bottomTab('Library')).toHaveClass(/active/);
    await expect(nav.bottomTab('Papers')).not.toHaveClass(/active/);
    await expectNoHorizontalScroll(page);
  });

  test('the tab bar fits in Portuguese too', async ({ page }) => {
    const nav = new SidebarPage(page);
    await signIn(page);
    await page.goto(`${BASE_URL}/pt-BR/papers`);

    await expect(nav.bottomTab('Biblioteca', nav.bottomNavPt)).toBeVisible();
    await expect(nav.bottomTab('Papers', nav.bottomNavPt)).toBeVisible();
    expect(await nav.bottomLabelsFit()).toBe(true);
  });
});
