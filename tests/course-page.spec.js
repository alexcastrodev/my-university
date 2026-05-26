// @ts-check
import { test, expect } from '@playwright/test';
import { gotoCourse, EXAM_ID } from './BaseTest.js';
import { CoursePage } from './pages/CoursePage.js';
import { PlaylistPage } from './pages/PlaylistPage.js';
import { HeaderPage } from './pages/HeaderPage.js';

test.describe('Course Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoCourse(page);
  });

  test.describe('Header', () => {
    test('should render header on course page', async ({ page }) => {
      const header = new HeaderPage(page);
      await expect(header.header).toBeVisible();
      await expect(header.brandLink).toBeVisible();
      await expect(header.examsLink).toBeVisible();
    });
  });

  test.describe('Layout', () => {
    test('should render two-column layout with main content and playlist', async ({ page }) => {
      const course = new CoursePage(page);
      const playlist = new PlaylistPage(page);
      await expect(course.layout).toBeVisible();
      await expect(course.mainContent).toBeVisible();
      await expect(playlist.aside).toBeVisible();
    });

    test('main content should have overflow-y auto', async ({ page }) => {
      test.skip(page.viewportSize()?.width < 900, 'overflow-y is visible on mobile layout');
      const course = new CoursePage(page);
      expect(await course.mainContentOverflowY()).toBe('auto');
    });
  });

  test.describe('Course Hero', () => {
    test('should render hero section with title', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.heroSection).toBeVisible();
      await expect(course.courseTitle).toBeVisible();
    });
  });

  test.describe('Course Info', () => {
    test('should render quiz banner with start exam button', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.quizBanner).toBeVisible();
      await expect(course.startExamBtn).toBeVisible();
    });

    test('should render audience info card', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.infoCard('Audience')).toBeVisible();
    });

    test('should render number of modules info card', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.infoCard('Number of Modules')).toBeVisible();
    });

    test('should render course duration info card', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.infoCard('Course Duration')).toBeVisible();
    });
  });

  test.describe('Playlist', () => {
    test('should render playlist with title', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await expect(playlist.aside).toBeVisible();
      await expect(page.getByText('Playlist').first()).toBeVisible();
    });

    test('should render search input in playlist', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await expect(playlist.searchInput).toBeVisible();
    });

    test('should render playlist footer with course duration', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await expect(playlist.footer).toBeVisible();
      await expect(playlist.footerDuration).toBeVisible();
    });

    test('modules list should have overflow-y auto', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await expect(playlist.modulesList).toBeVisible();
      expect(await playlist.overflowY()).toBe('auto');
    });

    test('should render first module expanded by default', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await expect(playlist.modulesList.locator('.lessons-list').first()).toBeVisible();
    });

    test('should collapse a module when clicking its header', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      const firstModuleHeader = playlist.modulesList.locator('.module-header').first();
      await firstModuleHeader.click();
      await expect(playlist.modulesList.locator('.lessons-list').first()).not.toBeVisible();
    });

    test('should expand a collapsed module when clicking its header', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      const secondModuleHeader = playlist.modulesList.locator('.module-header').nth(1);
      await secondModuleHeader.click();
      await expect(playlist.modulesList.locator('.lessons-list').nth(1)).toBeVisible();
    });

    test('should navigate to lesson when clicking a lesson button', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      const firstLesson = playlist.modulesList.locator('.lesson').first();
      await firstLesson.click();
      await expect(page).toHaveURL(/\/exam\/.+\/lesson\/.+/);
    });
  });

  test.describe('Lesson View', () => {
    test.beforeEach(async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await playlist.modulesList.locator('.lesson').first().click();
    });

    test('should render lesson header with back button', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.lessonHeader).toBeVisible();
      await expect(course.backBtn).toBeVisible();
    });

    test('should render lesson title in header bar', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.lessonTitleBar).toBeVisible();
    });

    test('should render mark completed button', async ({ page }) => {
      const course = new CoursePage(page);
      await expect(course.markCompleteBtn).toBeVisible();
    });

    test('should highlight active lesson in playlist', async ({ page }) => {
      const playlist = new PlaylistPage(page);
      await expect(playlist.modulesList.locator('.lesson.active')).toBeVisible();
    });

    test('should return to course overview when clicking back', async ({ page }) => {
      const course = new CoursePage(page);
      await course.backBtn.click();
      await expect(page).toHaveURL(new RegExp(`/exam/${EXAM_ID}$`));
      await expect(course.heroSection).toBeVisible();
    });
  });
});
