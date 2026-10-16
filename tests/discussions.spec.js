import { test, expect } from '@playwright/test';
import { DiscussionsPage } from './pages/DiscussionsPage.js';

test.describe('Discussions page (signed out)', () => {
  test.beforeEach(async ({ page }) => {
    await new DiscussionsPage(page).goto();
  });

  test('shows the heading and the three tabs', async ({ page }) => {
    const discussions = new DiscussionsPage(page);
    await expect(discussions.heading).toBeVisible();
    await expect(discussions.tabs).toHaveCount(3);
    await expect(discussions.allTab).toHaveAttribute('aria-selected', 'true');
  });

  test('lists discussions or says there are none', async ({ page }) => {
    const discussions = new DiscussionsPage(page);
    await expect(discussions.emptyOrList.first()).toBeVisible();
  });

  test('links each discussion to its concept with the marker open', async ({ page }) => {
    const discussions = new DiscussionsPage(page);
    await expect(discussions.emptyOrList.first()).toBeVisible();
    test.skip((await discussions.items.count()) === 0, 'no discussions in this database');
    expect(await discussions.firstItemHref()).toMatch(/\?m=\d+$/);
  });

  test('asks to log in on Mine and Participated', async ({ page }) => {
    const discussions = new DiscussionsPage(page);
    await discussions.openTab(discussions.mineTab);
    await expect(discussions.loginLink).toBeVisible();
    await discussions.openTab(discussions.participatedTab);
    await expect(discussions.loginLink).toBeVisible();
  });
});
