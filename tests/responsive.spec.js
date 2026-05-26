import { test, expect } from '@playwright/test';
import { gotoCourse, gotoExamList, setViewport, scrollToBottom } from './BaseTest.js';
import { HeaderPage } from './pages/HeaderPage.js';
import { PlaylistPage } from './pages/PlaylistPage.js';
import { CoursePage } from './pages/CoursePage.js';

test.describe('Responsive Layout', () => {
  test.describe('Desktop (1440px)', () => {
    test.beforeEach(async ({ page }) => {
      await setViewport(page, 'desktop');
      await gotoCourse(page);
    });

    test('should show two-column layout', async ({ page }) => {
      const course = new CoursePage(page);
      expect(await course.layoutGridColumns()).toMatch(/300px/);
    });

    test('should show header search box', async ({ page }) => {
      const header = new HeaderPage(page);
      await expect(header.searchInput).toBeVisible();
    });

    test('playlist should be visible in sidebar', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await expect(playlist.aside).toBeVisible();
      const box = await playlist.aside.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(250);
    });

    test('playlist list should have overflow-y auto', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      expect(await playlist.overflowY()).toBe('auto');
    });
  });

  test.describe('Tablet (768px)', () => {
    test.beforeEach(async ({ page }) => {
      await setViewport(page, 'tablet');
      await gotoCourse(page);
    });

    test('should stack layout in single column', async ({ page }) => {
      const course = new CoursePage(page);
      expect(await course.layoutGridColumns()).not.toMatch(/300px/);
    });

    test('main content should be full width', async ({ page }) => {
      const course = new CoursePage(page);
      const box = await course.mainContent.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(600);
    });

    test('playlist should appear below main content after scroll', async ({ page }) => {
      await scrollToBottom(page);
      const playlist = new PlaylistPage(page);
      await expect(playlist.aside).toBeVisible();
    });

    test('course hero should be full width', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.heroSection).toBeVisible();
      const box = await course.heroSection.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(600);
    });
  });

  test.describe('Mobile (375px)', () => {
    test.beforeEach(async ({ page }) => {
      await setViewport(page, 'mobile');
      await gotoCourse(page);
    });

    test('should hide header search box', async ({ page }) => {
      const header = new HeaderPage(page);
      await expect(header.searchInput).not.toBeVisible();
    });

    test('should render brand and nav links', async ({ page }) => {
      const header = new HeaderPage(page);
      await expect(header.brandLink).toBeVisible();
      await expect(header.avatarBtn).toBeVisible();
    });

    test('main content should be full viewport width', async ({ page }) => {
      const course = new CoursePage(page);
      const box = await course.mainContent.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThanOrEqual(370);
    });

    test('playlist should appear below main content after scroll', async ({ page }) => {
      await scrollToBottom(page);
      const playlist = new PlaylistPage(page);
      await expect(playlist.aside).toBeVisible();
    });

    test('exam list page should render correctly', async ({ page }) => {
      await gotoExamList(page);
      await expect(page.getByRole('heading', { name: 'Certification Exams' })).toBeVisible();
      await expect(page.locator('.exam-card').first()).toBeVisible();
    });
  });
});
