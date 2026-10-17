import { test, expect } from '@playwright/test';
import { ConceptLabPage } from './pages/ConceptLabPage.js';

const CONCEPT = '/dotnet-testing-concepts/testing-clean-architecture-with-mstest';

test.describe('Concept Lab tab (signed out)', () => {
  test('offers the Lab tab with the open-lab link and the summary', async ({ page }) => {
    const lab = new ConceptLabPage(page);
    await lab.goto(CONCEPT);
    await expect(lab.labTab).toBeVisible();
    await lab.openLab();
    await expect(lab.openLabLink).toHaveAttribute('href', /university-kurz-labs\/tree\/master\/dotnet-testing-concepts\/testing-clean-architecture-with-mstest/);
    await expect(lab.summary).toContainText('TODO');
  });

  test('shows the discussion read-only with a sign in link', async ({ page }) => {
    const lab = new ConceptLabPage(page);
    await lab.goto(`${CONCEPT}?tab=lab`);
    await expect(lab.discussionHeading).toBeVisible();
    await expect(lab.signInLink).toBeVisible();
    await expect(lab.composer).toHaveCount(0);
  });
});
