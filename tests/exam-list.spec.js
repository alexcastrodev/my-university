import { test, expect } from '@playwright/test';
import { BASE_URL, gotoExamList } from './BaseTest.js';
import { ExamListPage } from './pages/ExamListPage.js';
import { SidebarPage } from './pages/SidebarPage.js';

test.describe('Exam List Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoExamList(page);
  });

  test.describe('Header', () => {
    test('should render header with brand, nav and search', async ({ page }) => {
      test.skip((page.viewportSize()?.width ?? 1280) < 768, 'phones swap the sidebar for the bottom tab bar, see responsive.spec.js');
      const header = new SidebarPage(page);
      await expect(header.sidebar).toBeVisible();
      await expect(header.brandLink).toBeVisible();
      await expect(header.tracksLink).toBeVisible();
      // The exams live on their own page, so the sidebar links straight to it and it is highlighted here.
      await expect(header.certificationsLink).toBeVisible();
      await expect(header.certificationsLink).toHaveClass(/active/);
      const vp = page.viewportSize();
      if (!vp || vp.width >= 768) {
        await expect(header.searchInput).toBeVisible();
      }
      await expect(header.avatarBtn).toBeVisible();
    });
  });

  test.describe('Hero', () => {
    test('should render page title and subtitle', async ({ page }) => {
      const examList = new ExamListPage(page);
      await expect(examList.heading).toBeVisible();
      await expect(examList.subtitle).toBeVisible();
    });
  });

  test.describe('Exam Cards', () => {
    test('should render at least one exam card', async ({ page }) => {
      const examList = new ExamListPage(page);
      await expect(examList.examCards.first()).toBeVisible();
    });

    test('should render OCP Java SE 21 exam card', async ({ page }) => {
      const examList = new ExamListPage(page);
      const card = examList.examCard('OCP Java SE 21 Developer');
      await expect(card).toBeVisible();
      await expect(card.getByText('Start Practice →')).toBeVisible();
    });

    test('should render OCP Java SE 25 exam card', async ({ page }) => {
      const examList = new ExamListPage(page);
      const card = examList.examCard('OCP Java SE 25 Developer');
      await expect(card).toBeVisible();
      await expect(card.getByText('Start Practice →')).toBeVisible();
    });

    test('should render the Azure AI-200 exam card', async ({ page }) => {
      const examList = new ExamListPage(page);
      const card = examList.examCard('Azure AI Cloud Developer Associate');
      await expect(card).toBeVisible();
      await expect(card.getByText('Start Practice →')).toBeVisible();
    });

    test('should navigate to course page when clicking exam card', async ({ page }) => {
      const examList = new ExamListPage(page);
      await examList.examCard('OCP Java SE 21 Developer').click();
      await expect(page).toHaveURL(/\/exam\/java-21$/);
    });
  });

  test.describe('Providers', () => {
    test('should group the Java exams under Oracle and the Azure exam under Microsoft', async ({ page }) => {
      const examList = new ExamListPage(page);
      await expect(examList.provider('Oracle Java').locator('.exam-card')).toHaveCount(2);
      await expect(examList.provider('Microsoft Azure').locator('.exam-card')).toHaveCount(1);
    });

    test('should list the newest Java release first', async ({ page }) => {
      const examList = new ExamListPage(page);
      const titles = examList.provider('Oracle Java').locator('.card-title');
      await expect(titles.first()).toContainText('OCP Java SE 25');
    });
  });

  test.describe('Legacy URLs', () => {
    // nginx answers these with a permanent redirect, so the old /java/... links keep working.
    test('should redirect /java/exams to /exams', async ({ page }) => {
      await page.goto(`${BASE_URL}/java/exams`);
      await expect(page).toHaveURL(/\/exams$/);
    });

    test('should redirect a legacy /java/exam/<id> course link', async ({ page }) => {
      await page.goto(`${BASE_URL}/java/exam/java-25`);
      await expect(page).toHaveURL(/\/exam\/java-25$/);
    });
  });
});
