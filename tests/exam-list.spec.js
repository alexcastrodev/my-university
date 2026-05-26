import { test, expect } from '@playwright/test';
import { gotoExamList } from './BaseTest.js';
import { ExamListPage } from './pages/ExamListPage.js';
import { HeaderPage } from './pages/HeaderPage.js';

test.describe('Exam List Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoExamList(page);
  });

  test.describe('Header', () => {
    test('should render header with brand, nav and search', async ({ page }) => {
      const header = new HeaderPage(page);
      await expect(header.header).toBeVisible();
      await expect(header.brandLink).toBeVisible();
      await expect(header.examsLink).toBeVisible();
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

    test('should group exams by category', async ({ page }) => {
      const examList = new ExamListPage(page);
      await expect(examList.categorySections.first()).toBeVisible();
      await expect(examList.categorySection('Language')).toBeVisible();
    });

    test('should navigate to course page when clicking exam card', async ({ page }) => {
      const examList = new ExamListPage(page);
      await examList.examCard('OCP Java SE 21 Developer').click();
      await expect(page).toHaveURL(/\/exam\/java-21/);
    });
  });
});
