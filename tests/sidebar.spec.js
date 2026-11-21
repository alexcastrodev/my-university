import { test, expect } from '@playwright/test';
import { SidebarPage } from './pages/SidebarPage.js';

// The sidebar is a floating card: an icon rail unless the reader expanded it. Phones have a tab bar instead
// (see phone-navigation.spec.js), so every test here is for the desktop projects.
test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'Phones have no sidebar; the bottom tab bar takes over.');
  await new SidebarPage(page).goto();
});

test.describe('Sidebar as an icon rail', () => {
  test('hovering an icon names it in a tooltip beside the card, and leaving takes it away', async ({ page }) => {
    const sidebar = new SidebarPage(page);
    await expect(sidebar.root).toHaveAttribute('data-sidebar', 'collapsed');

    await sidebar.navLink('Tracks').hover();
    await expect(sidebar.tooltip).toBeVisible();
    await expect(sidebar.tooltip).toHaveText('Tracks');
    await expect(sidebar.navLink('Tracks')).toHaveAttribute('aria-describedby', await sidebar.tooltipId);
    const card = await sidebar.cardBox();
    const tip = await sidebar.tooltipBox();
    expect(tip.x).toBeGreaterThanOrEqual(card.x + card.width);

    await sidebar.pointerAway();
    await expect(sidebar.tooltip).toBeHidden();
    await expect(sidebar.navLink('Tracks')).not.toHaveAttribute('aria-describedby');
  });

  test('keyboard focus shows the tooltip too, and Escape closes it', async ({ page }) => {
    const sidebar = new SidebarPage(page);
    await sidebar.brandLink.focus();
    await sidebar.pressTab();
    await expect(sidebar.searchInput).toBeFocused();
    await expect(sidebar.tooltip).toHaveText('Search');

    await sidebar.pressEscape();
    await expect(sidebar.tooltip).toBeHidden();
  });

  test('the theme control is one Light | Dark group and the choice is kept', async ({ page }) => {
    const sidebar = new SidebarPage(page);
    await expect(sidebar.lightBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar.darkBtn).toHaveAttribute('aria-pressed', 'false');

    await sidebar.darkBtn.click();
    await expect(sidebar.root).toHaveAttribute('data-theme', 'dark');
    await expect(sidebar.darkBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar.lightBtn).toHaveAttribute('aria-pressed', 'false');

    await sidebar.reload();
    await expect(sidebar.root).toHaveAttribute('data-theme', 'dark');
    await expect(sidebar.darkBtn).toHaveAttribute('aria-pressed', 'true');

    await sidebar.lightBtn.click();
    await expect(sidebar.root).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('Sidebar expanded', () => {
  test('the toggle opens the labels, shows no tooltip and is remembered after a reload', async ({ page }) => {
    const sidebar = new SidebarPage(page);
    await sidebar.expandBtn.click();
    await expect(sidebar.root).toHaveAttribute('data-sidebar', 'expanded');
    await expect(sidebar.collapseBtn).toBeVisible();
    await expect(sidebar.navLink('Tracks')).toContainText('Tracks');
    await expect(sidebar.groupTitle('Study')).toBeVisible();

    // The words are in plain view, so a tooltip would only repeat them.
    await sidebar.navLink('Tracks').hover();
    await expect(sidebar.tooltip).toBeHidden();

    await sidebar.reload();
    await expect(sidebar.root).toHaveAttribute('data-sidebar', 'expanded');

    await sidebar.collapseBtn.click();
    await expect(sidebar.root).toHaveAttribute('data-sidebar', 'collapsed');
  });
});

test.describe('The page next to the sidebar', () => {
  for (const state of ['rail', 'expanded']) {
    for (const width of [1440, 1024]) {
      test(`starts right after the ${state} card at ${width}px, with no overlap and no empty strip`, async ({ page }) => {
        const sidebar = new SidebarPage(page);
        await sidebar.showAs(state, width);

        // The air around the card is the 8px inset on both sides of it.
        expect(Math.round(await sidebar.gapToContent())).toBe(8);
        const card = await sidebar.cardBox();
        expect(Math.round(card.x)).toBe(8);
        expect(Math.round(card.width)).toBe(state === 'rail' ? 56 : 216);
        expect(await sidebar.horizontalOverflow()).toBeLessThanOrEqual(1);
      });
    }
  }
});
