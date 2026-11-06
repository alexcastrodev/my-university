import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { FaqPage } from './pages/FaqPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { PublicProfilePage } from './pages/PublicProfilePage.js';

// The public link on the profile banner (copy, open), removing a custom link behind a question, and the Library
// tab of the public profile with the FAQ that explains how to fill it. The books themselves are covered by unit
// tests: the test reader has no file in the repository, so the tab here is always the empty one.
const token = `pl${Math.random().toString(36).slice(2, 8)}`;
const ID = /\/u\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

async function setSlug(page, slug) {
  const res = await page.request.put(`${BASE_URL}/api/auth/profile-slug`, { data: { slug } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('the public link on the banner', () => {
  test('shows the link made of the id, and the open button leads a new tab to the public profile', async ({ page, context }) => {
    await signIn(page, 'Link');
    const profile = new ProfilePage(page);
    await profile.goto();

    await expect(profile.publicLinkText).toHaveText(ID);
    await expect(profile.openLink).toHaveAttribute('target', '_blank');
    const [tab] = await Promise.all([context.waitForEvent('page'), profile.openLink.click()]);
    const visitor = new PublicProfilePage(tab);
    await expect(visitor.libraryTab).toBeVisible();
    await expect(visitor.overviewTab).toBeVisible();
    await expect(tab).toHaveURL(ID);
  });

  test('copies the link from the icon in the pill', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions can only be granted in Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, 'Copy');
    const profile = new ProfilePage(page);
    await profile.goto();

    const link = (await profile.publicLinkText.textContent()).trim();
    await profile.copyButton.click();
    await expect(profile.copyButton).toHaveAccessibleName('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });

  test('offers no link while the profile is private', async ({ page }) => {
    await signIn(page, 'Private');
    const res = await page.request.put(`${BASE_URL}/api/auth/settings`, { data: { profilePublic: false } });
    expect(res.ok()).toBeTruthy();
    const profile = new ProfilePage(page);
    await profile.goto();

    await expect(profile.editButton).toBeVisible();
    await expect(profile.publicLinkText).toHaveCount(0);
    await expect(profile.openLink).toHaveCount(0);
  });
});

test.describe('removing the custom link', () => {
  test.beforeEach(async ({ page }, info) => {
    await signIn(page, 'Custom');
    info.slug = `custom-${token}-${info.workerIndex}-${info.retry}`;
    await setSlug(page, info.slug);
  });

  test('shows the custom link, asks before removing it, and keeps it when cancelled', async ({ page }, info) => {
    const profile = new ProfilePage(page);
    await profile.goto();
    await expect(profile.publicLinkText).toHaveText(new RegExp(`/u/${info.slug}$`));

    await profile.openEditor();
    await profile.removeCustomLink.click();
    await expect(profile.dialog).toBeVisible();
    await profile.cancel.click();
    await expect(profile.dialog).toBeHidden();
    await expect(profile.publicLinkText).toHaveText(new RegExp(`/u/${info.slug}$`));
  });

  test('goes back to the link made of the id once confirmed, and the old link stops working', async ({ page, browser }, info) => {
    const profile = new ProfilePage(page);
    await profile.goto();
    await profile.openEditor();
    await profile.removeCustomLink.click();
    await expect(profile.dialog).toBeVisible();
    await profile.confirmRemoval();

    await expect(profile.dialog).toBeHidden();
    await expect(profile.publicLinkText).toHaveText(ID);
    await expect(profile.removeCustomLink).toHaveCount(0);

    const stranger = await browser.newContext();
    const visitor = new PublicProfilePage(await stranger.newPage());
    await visitor.goto(info.slug);
    await expect(visitor.missing).toBeVisible();
    await stranger.close();
  });

  test('closes the question with Escape without removing anything', async ({ page }, info) => {
    const profile = new ProfilePage(page);
    await profile.goto();
    await profile.openEditor();
    await profile.removeCustomLink.click();
    await expect(profile.dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(profile.dialog).toBeHidden();
    await expect(profile.publicLinkText).toHaveText(new RegExp(`/u/${info.slug}$`));
  });
});

test.describe('the Library tab', () => {
  test('is on the public profile, selected on its own address, and says it is empty with a way to learn how', async ({ page }) => {
    await signIn(page, 'Library');
    const slug = `lib-${token}`;
    await setSlug(page, slug);
    const visitor = new PublicProfilePage(page);
    await visitor.goto(slug);

    await expect(visitor.overviewTab).toHaveClass(/tab-active/);
    await visitor.libraryTab.click();
    await expect(page).toHaveURL(new RegExp(`/u/${slug}/books$`));
    await expect(visitor.libraryTab).toHaveClass(/tab-active/);
    await expect(visitor.emptyLibrary).toBeVisible();

    await visitor.howToShowBooks.click();
    await expect(page).toHaveURL(/\/faq#books$/);
    await expect(new FaqPage(page).booksHeading).toBeInViewport();
  });

  test('is reached directly by its address and shows the same missing page as the profile when it is private', async ({ page, browser }) => {
    await signIn(page, 'Hidden');
    const id = (await (await page.request.get(`${BASE_URL}/api/auth/me`)).json()).publicProfileId;
    const stranger = await browser.newContext();
    const visitor = new PublicProfilePage(await stranger.newPage());

    await visitor.goto(id, 'books');
    await expect(visitor.libraryTab).toHaveClass(/tab-active/);

    await page.request.put(`${BASE_URL}/api/auth/settings`, { data: { profilePublic: false } });
    await visitor.goto(id, 'books');
    await expect(visitor.missing).toBeVisible();
    await stranger.close();
  });

  test('never needs a sideways scroll', async ({ page }) => {
    await signIn(page, 'Narrow');
    const slug = `narrow-${token}`;
    await setSlug(page, slug);
    const visitor = new PublicProfilePage(page);
    await visitor.goto(slug, 'books');
    await expect(visitor.emptyLibrary).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('the FAQ', () => {
  test('explains how to show books, at #books', async ({ page }) => {
    const faq = new FaqPage(page);
    await faq.goto('#books');

    await expect(faq.booksHeading).toBeInViewport();
    await expect(faq.steps).toHaveCount(6);
    await expect(faq.example).toContainText('| Book | Pages | Cover |');
    await expect(faq.folderLink).toHaveAttribute('href', 'https://github.com/alexcastrodev/my-university/tree/main/public/books');
  });

  test('never needs a sideways scroll', async ({ page }) => {
    await new FaqPage(page).goto();
    await expectNoHorizontalScroll(page);
  });
});
