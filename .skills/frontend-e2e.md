# Frontend E2E Testing with Playwright

## Structure

```
tests/
├── BaseTest.js         ← shared helpers (navigation, viewport, scroll)
├── pages/              ← Page Objects, one per page/component
│   ├── HeaderPage.js
│   ├── PlaylistPage.js
│   ├── ExamListPage.js
│   └── CoursePage.js
├── exam-list.spec.js
├── course-page.spec.js
└── responsive.spec.js
```

## Core Rule: Page Objects own the page, specs only assert

Page Objects are responsible for **everything that touches the DOM**:
- Selectors and locators
- `waitFor` calls
- `page.evaluate` / `getComputedStyle` / `querySelector`
- Complex interactions (scroll, click sequences)

Specs are responsible for **nothing but assertions**:
- Instantiate the Page Object
- Call a method
- `expect(result).toBe(...)`

**Wrong** — DOM logic leaking into the spec:
```js
test('playlist should scroll', async ({ page }) => {
  await page.locator('.modules-list').waitFor();
  const overflow = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.modules-list')).overflowY
  );
  expect(overflow).toBe('auto');
});
```

**Correct** — Page Object encapsulates the knowledge:
```js
// PlaylistPage.js
async overflowY() {
  await this.modulesList.waitFor();
  return this.page.evaluate(() =>
    getComputedStyle(document.querySelector('.modules-list')).overflowY
  );
}

// responsive.spec.js
test('playlist list should have overflow-y auto', async ({ page }) => {
  const playlist = new PlaylistPage(page);
  expect(await playlist.overflowY()).toBe('auto');
});
```

## BaseTest.js conventions

Export standalone helpers for navigation and setup — do not use a custom `test` fixture unless shared state is needed:

```js
export async function gotoCourse(page, examId = EXAM_ID) {
  await page.goto(`${BASE_URL}/exam/${examId}`);
}

export async function setViewport(page, name) {
  await page.setViewportSize(VIEWPORTS[name]);
}

export async function scrollToBottom(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}
```

## Page Object conventions

- Constructor receives `page` and defines all locators as `this.*` properties
- Locators use semantic selectors first (`getByRole`, `getByLabel`), CSS classes second
- Methods that read computed state return the value (not a boolean wrapper) so the spec controls the assertion
- Methods that perform interactions return `void`

```js
export class PlaylistPage {
  constructor(page) {
    this.page = page;
    this.aside       = page.getByRole('complementary', { name: 'Course playlist' });
    this.searchInput = page.getByRole('searchbox', { name: 'Search within playlist' });
    this.modulesList = page.locator('.modules-list');
    this.footer      = page.locator('.playlist-footer');
  }

  async overflowY() {
    await this.modulesList.waitFor();
    return this.page.evaluate(() =>
      getComputedStyle(document.querySelector('.modules-list')).overflowY
    );
  }

  async toggleModule(title) {
    await this.page.getByRole('button', { name: new RegExp(title, 'i') }).click();
  }
}
```

## Spec conventions

- No `// @ts-check` — these are plain JS test files
- Group with `test.describe` by page, then by feature area
- Use `test.beforeEach` to navigate; avoid repetition in each test
- One assertion per test where practical

```js
import { test, expect } from '@playwright/test';
import { gotoCourse } from './BaseTest.js';
import { PlaylistPage } from './pages/PlaylistPage.js';

test.describe('Course Page › Playlist', () => {
  test.beforeEach(async ({ page }) => {
    await gotoCourse(page);
  });

  test('modules list should have overflow-y auto', async ({ page }) => {
    const playlist = new PlaylistPage(page);
    expect(await playlist.overflowY()).toBe('auto');
  });
});
```

## Responsive testing

Define viewports in `BaseTest.js` and use `setViewport` in `beforeEach`. Put computed-style checks and bounding-box reads in the Page Object:

```js
// CoursePage.js
async layoutGridColumns() {
  await this.layout.waitFor();
  return this.page.evaluate(() =>
    getComputedStyle(document.querySelector('.layout')).gridTemplateColumns
  );
}

// responsive.spec.js
test('should show two-column layout', async ({ page }) => {
  const course = new CoursePage(page);
  expect(await course.layoutGridColumns()).toMatch(/300px/);
});
```

## playwright.config.js

Always set `baseURL`. Include mobile projects:

```js
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://localhost', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
  ],
});
```
