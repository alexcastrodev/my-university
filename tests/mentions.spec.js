import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { ConceptDiscussionPage } from './pages/ConceptDiscussionPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';

// One reader mentions another in the discussion at the end of a concept, picking them from the `@`
// suggestions with the keyboard; the other sees the mention in their notifications and lands on the concept.
const token = Math.random().toString(36).slice(2, 8);
const CONCEPT = '/java/java-concepts/equals-vs-compareto';

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: name } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

async function setSlug(page, slug) {
  const res = await page.request.put(`${BASE_URL}/api/auth/profile-slug`, { data: { slug } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test('mentions someone picked from the suggestions, who then gets a notification', async ({ browser }) => {
  const anaContext = await browser.newContext({ baseURL: BASE_URL });
  const biaContext = await browser.newContext({ baseURL: BASE_URL });
  const anaPage = await anaContext.newPage();
  const biaPage = await biaContext.newPage();
  const handle = `ana-${token}`;
  const bia = `Bia ${token}`;

  await signIn(anaPage, `Ana ${token}`);
  await setSlug(anaPage, handle);
  await signIn(biaPage, bia);

  const discussion = new ConceptDiscussionPage(biaPage);
  await discussion.goto(CONCEPT);
  await discussion.type(`Thanks @ana-${token.slice(0, 3)}`);
  await expect(discussion.option(handle)).toBeVisible();
  await expect(discussion.composer).toHaveAttribute('aria-expanded', 'true');
  await discussion.press('Enter');
  await expect(discussion.suggestions).toBeHidden();
  await expect(discussion.composer).toHaveValue(`Thanks @${handle} `);
  await discussion.type('for the tip');
  await discussion.post();
  await expect(discussion.mentionLink(handle)).toBeVisible();

  const inbox = new NotificationsPage(anaPage);
  await inbox.goto();
  const item = inbox.item(`${bia} mentioned you`);
  await expect(item).toBeVisible();
  await item.click();
  await expect(anaPage).toHaveURL(new RegExp(`${CONCEPT}#discussion$`));

  await anaContext.close();
  await biaContext.close();
});

test('an Escape closes the suggestions and keeps what was typed', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  const handle = `cai-${token}`;
  await signIn(page, `Cai ${token}`);
  await setSlug(page, handle);
  await signIn(page, `Dee ${token}`);

  const discussion = new ConceptDiscussionPage(page);
  await discussion.goto(CONCEPT);
  await discussion.type(`@cai-${token.slice(0, 3)}`);
  await expect(discussion.option(handle)).toBeVisible();
  await discussion.press('Escape');
  await expect(discussion.suggestions).toBeHidden();
  await expect(discussion.composer).toHaveValue(`@cai-${token.slice(0, 3)}`);
  await context.close();
});
