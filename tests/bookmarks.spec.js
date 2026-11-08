import { test, expect } from '@playwright/test';
import { BASE_URL } from './BaseTest.js';
import { BookmarksPage } from './pages/BookmarksPage.js';
import { ConceptLabPage } from './pages/ConceptLabPage.js';

// Real concepts (backend/src/seed/data). The first testing one and the Spring one have a Lab, so they show the
// tab. Every test signs in as a reader of its own, so the bookmarks it places are nobody else's.
const token = `bm${Math.random().toString(36).slice(2, 8)}`;
const TESTING = '/java/testing/junit-5-fundamentals';
const TESTING_OTHER = '/java/testing/junit-5-architecture';
const SPRING = '/spring-concepts/spring-boot-autoconfiguration';
const TESTING_AREA = 'Java Testing';
const SPRING_AREA = 'Spring';

async function signIn(page, name) {
  const res = await page.request.post(`${BASE_URL}/api/auth/_test/login`, { data: { displayName: `${name} ${token}` } });
  expect(res.ok(), 'POST /api/auth/_test/login (needs ENABLE_DEV_AUTH=1)').toBeTruthy();
}

test.describe('bookmarks', () => {
  test('placing a bookmark keeps the place in that module', async ({ page }) => {
    await signIn(page, 'place');
    const concept = new ConceptLabPage(page);
    const bookmarks = new BookmarksPage(page);

    await concept.goto(TESTING);
    await expect(concept.bookmarkButton).toHaveText(/Bookmark here/);
    await concept.bookmarkButton.click();
    await expect(concept.bookmarkButton).toHaveText(/Bookmarked/);

    await bookmarks.goto();
    await expect(bookmarks.rows).toHaveCount(1);
    await expect(bookmarks.rowLink(TESTING_AREA)).toHaveAttribute('href', TESTING);
  });

  test('bookmarking another concept of the module moves it, and other modules keep theirs', async ({ page }) => {
    await signIn(page, 'move');
    const concept = new ConceptLabPage(page);
    const bookmarks = new BookmarksPage(page);

    for (const path of [TESTING, TESTING_OTHER, SPRING]) {
      await concept.goto(path);
      await concept.bookmarkButton.click();
      await expect(concept.bookmarkButton).toHaveText(/Bookmarked/);
    }

    await bookmarks.goto();
    await expect(bookmarks.rows).toHaveCount(2);
    await expect(bookmarks.rowLink(TESTING_AREA)).toHaveAttribute('href', TESTING_OTHER);
    await expect(bookmarks.rowLink(SPRING_AREA)).toHaveAttribute('href', SPRING);
  });

  test('a bookmark placed on the Lab tab brings the reader back to the Lab tab', async ({ page }) => {
    await signIn(page, 'lab-tab');
    const concept = new ConceptLabPage(page);
    const bookmarks = new BookmarksPage(page);

    await concept.goto(TESTING);
    await concept.openLab();
    await concept.bookmarkButton.click();
    await expect(concept.bookmarkButton).toHaveText(/Bookmarked/);

    // On the concept tab the bookmark is not "here": it is in the lab.
    await concept.conceptTab.click();
    await expect(concept.bookmarkButton).toHaveText(/Bookmark here/);

    await bookmarks.goto();
    await expect(bookmarks.row(TESTING_AREA)).toContainText('Lab');
    await bookmarks.rowLink(TESTING_AREA).click();
    await expect(page).toHaveURL(/tab=lab/);
    await expect(concept.openLabLink).toBeVisible();
  });

  test('removing a bookmark empties the page and frees the button', async ({ page }) => {
    await signIn(page, 'remove');
    const concept = new ConceptLabPage(page);
    const bookmarks = new BookmarksPage(page);

    await concept.goto(TESTING);
    await concept.bookmarkButton.click();
    await expect(concept.bookmarkButton).toHaveText(/Bookmarked/);

    await bookmarks.goto();
    await bookmarks.removeButton(TESTING_AREA).click();
    await expect(bookmarks.rows).toHaveCount(0);
    await expect(bookmarks.empty).toBeVisible();

    await concept.goto(TESTING);
    await expect(concept.bookmarkButton).toHaveText(/Bookmark here/);
  });

  test('the rail lists the bookmark and links to the page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Phones have no sidebar; the home shortcut carries the way in.');
    await signIn(page, 'rail');
    const concept = new ConceptLabPage(page);
    const bookmarks = new BookmarksPage(page);

    await concept.goto(TESTING);
    await concept.bookmarkButton.click();
    await expect(concept.bookmarkButton).toHaveText(/Bookmarked/);

    await expect(bookmarks.sidebarItems).toHaveCount(1);
    await expect(bookmarks.sidebarItems.first()).toContainText(TESTING_AREA);
    await bookmarks.sidebarLink.click();
    await expect(page).toHaveURL(/\/bookmarks$/);
    await expect(bookmarks.heading).toBeVisible();
  });

  test('on a phone the home screen links to the bookmarks page', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Only phones use the home shortcut.');
    await signIn(page, 'phone');
    const bookmarks = new BookmarksPage(page);

    await page.goto('/dashboard');
    await bookmarks.mobileShortcut.click();
    await expect(page).toHaveURL(/\/bookmarks$/);
    await expect(bookmarks.heading).toBeVisible();
  });
});

test.describe('finishing a lab', () => {
  test('"I finished the lab" is its own mark, apart from "Got it!"', async ({ page }) => {
    await signIn(page, 'finish');
    const concept = new ConceptLabPage(page);

    await concept.goto(`${TESTING}?tab=lab`);
    await expect(concept.finishedLabButton).toHaveText(/I finished the lab/);
    await concept.finishedLabButton.click();
    await expect(concept.finishedLabButton).toHaveText(/Lab finished/);
    // Doing the lab is not reading the article.
    await expect(concept.gotItButton).not.toHaveClass(/completed/);

    // It is remembered, and it can be undone.
    await page.reload();
    await expect(concept.finishedLabButton).toHaveText(/Lab finished/);
    await concept.finishedLabButton.click();
    await expect(concept.finishedLabButton).toHaveText(/I finished the lab/);
  });

  test('reading the concept does not finish the lab', async ({ page }) => {
    await signIn(page, 'read-only');
    const concept = new ConceptLabPage(page);

    await concept.goto(`${TESTING}?tab=lab`);
    await concept.gotItButton.click();
    await expect(concept.gotItButton).toHaveClass(/completed/);
    await expect(concept.finishedLabButton).toHaveText(/I finished the lab/);
  });

  test('a finished lab shows on its bookmark', async ({ page }) => {
    await signIn(page, 'badge');
    const concept = new ConceptLabPage(page);
    const bookmarks = new BookmarksPage(page);

    await concept.goto(`${TESTING}?tab=lab`);
    await concept.bookmarkButton.click();
    await expect(concept.bookmarkButton).toHaveText(/Bookmarked/);
    await concept.finishedLabButton.click();
    await expect(concept.finishedLabButton).toHaveText(/Lab finished/);

    await bookmarks.goto();
    await expect(bookmarks.row(TESTING_AREA)).toContainText('Lab finished');
  });
});

test.describe('signed out', () => {
  test('the bookmark and lab buttons are locked, and the page asks to log in', async ({ page }) => {
    const concept = new ConceptLabPage(page);
    const bookmarks = new BookmarksPage(page);

    await concept.goto(`${TESTING}?tab=lab`);
    await expect(concept.bookmarkButton).toBeDisabled();
    await expect(concept.finishedLabButton).toBeDisabled();

    await bookmarks.goto();
    await expect(bookmarks.loginPrompt).toBeVisible();
    await expect(bookmarks.rows).toHaveCount(0);
  });
});
