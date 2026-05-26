import { test as base, expect } from '@playwright/test';

export const BASE_URL = 'http://localhost';
export const EXAM_ID = 'java-21';

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet:  { width: 768,  height: 900 },
  mobile:  { width: 375,  height: 812 },
};

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto(BASE_URL);
    await use(page);
  },
});

export { expect };

export async function gotoExamList(page) {
  await page.goto(BASE_URL);
}

export async function gotoCourse(page, examId = EXAM_ID) {
  await page.goto(`${BASE_URL}/exam/${examId}`);
}

export async function gotoLesson(page, examId = EXAM_ID, lessonId) {
  await page.goto(`${BASE_URL}/exam/${examId}/lesson/${lessonId}`);
}

export async function gotoQuiz(page, examId = EXAM_ID) {
  await page.goto(`${BASE_URL}/exam/${examId}/quiz`);
}

export async function setViewport(page, name) {
  const vp = VIEWPORTS[name];
  await page.setViewportSize(vp);
}

export async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

export async function waitForNetworkIdle(page) {
  await page.waitForLoadState('networkidle');
}
