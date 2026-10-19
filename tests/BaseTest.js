import { test as base, expect } from '@playwright/test';

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost';
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

/** The login screen is GitHub OAuth now; the dev-only test route sets the same session cookie. */
async function login(page) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: 'Test User' } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

export async function gotoExamList(page) {
  await login(page);
  await page.goto(`${BASE_URL}/java/exams`);
  await page.waitForLoadState('networkidle');
}

export async function gotoCourse(page, examId = EXAM_ID) {
  const url = `${BASE_URL}/java/exam/${examId}`;
  await login(page);
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

export async function gotoLesson(page, examId = EXAM_ID, lessonId) {
  await page.goto(`${BASE_URL}/java/exam/${examId}/lesson/${lessonId}`);
}

export async function gotoQuiz(page, examId = EXAM_ID) {
  await page.goto(`${BASE_URL}/java/exam/${examId}/quiz`);
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
